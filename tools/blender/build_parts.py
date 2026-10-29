# -*- coding: utf-8 -*-
"""build_parts.py — детали BuildSense (машиностроение) в Blender по экспорту *.mech-freecad.json.

ВАЖНО: Blender строит СЕТКУ (многогранник), а не CAD-тело. Источник истины — параметры деталей в JSON;
точные твёрдые тела (и STEP) строит макрос FreeCAD freecad/import_parts.FCMacro. Этот скрипт нужен для
визуализации, рендера и STL/OBJ, а также как независимая сверка объёма.

Запуск:
  blender --background --python tools/blender/build_parts.py -- demo.mech-freecad.json OUT_DIR
  или в Python-консоли/через MCP:  exec(open(path).read()); build_from_file(json_path, out_dir)

Что делает:
  * сцена в миллиметрах: unit_settings.system=METRIC, scale_length=0.001, length_unit=MILLIMETERS
    (1 единица Blender = 1 мм);
  * детали — в коллекции BuildSense_Mech (прежнее содержимое этой коллекции удаляется, чужие объекты
    не трогаются);
  * тело вращения: профиль (r, z) в плоскости XZ → bmesh.ops.spin на 360° вокруг Z, сварка вершин на оси;
  * отверстия фланца: цилиндры-резцы → модификатор Boolean (DIFFERENCE, EXACT), применённый
    (сетка берётся из вычисленного объекта), резцы удаляются;
  * положение: Translation · Rx · Ry · Rz (как THREE.Euler "XYZ" и FreeCAD-макрос);
  * проверка bmesh: неманифолдные и граничные рёбра, объём calc_volume против аналитического, габарит;
  * экспорт STL (bpy.ops.wm.stl_export) и OBJ (bpy.ops.wm.obj_export) в мм, ось Z вверх.
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

COLLECTION = "BuildSense_Mech"
SEGMENTS = 128
HOLE_SEGMENTS = 48
MATERIAL_COLORS = {
    "steel": (0.60, 0.64, 0.68), "cast_iron": (0.42, 0.45, 0.48), "aluminum": (0.79, 0.82, 0.85),
    "bronze": (0.69, 0.55, 0.34), "brass": (0.78, 0.66, 0.32), "polyamide": (0.91, 0.89, 0.78),
}


def set_mm_units(scene):
    u = scene.unit_settings
    before = (u.system, u.scale_length, u.length_unit)
    u.system = "METRIC"
    u.scale_length = 0.001
    u.length_unit = "MILLIMETERS"
    return before


def get_collection(scene):
    col = bpy.data.collections.get(COLLECTION)
    if col is None:
        col = bpy.data.collections.new(COLLECTION)
    if col.name not in scene.collection.children:
        scene.collection.children.link(col)
    for obj in list(col.objects):  # только наши прежние объекты
        mesh = obj.data if obj.type == "MESH" else None
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh is not None and mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    return col


def placement_matrix(pl):
    r = pl.get("rotation", {})
    rot = (Matrix.Rotation(math.radians(r.get("x", 0)), 4, "X")
           @ Matrix.Rotation(math.radians(r.get("y", 0)), 4, "Y")
           @ Matrix.Rotation(math.radians(r.get("z", 0)), 4, "Z"))
    return Matrix.Translation(Vector((pl["x"], pl["y"], pl["z"]))) @ rot


def revolve_bmesh(profile, segments=SEGMENTS):
    """Замкнутый профиль (r, z) → замкнутая сетка вращения вокруг Z."""
    bm = bmesh.new()
    verts = [bm.verts.new((float(r), 0.0, float(z))) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[(i + 1) % len(verts)])) for i in range(len(verts))]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), dvec=(0, 0, 0),
                   angle=2 * math.pi, steps=segments, use_merge=True, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-3)  # вершины на оси (float32 при z≈180 мм — шаг ~1e-5)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges[:])
    loose = [e for e in bm.edges if not e.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="EDGES")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def mesh_object(name, bm, col):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    col.objects.link(obj)
    return obj


def material_for(key):
    name = "BuildSense_" + key
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        c = MATERIAL_COLORS.get(key, (0.6, 0.6, 0.6))
        if bsdf is not None:
            bsdf.inputs["Base Color"].default_value = (*c, 1.0)
            bsdf.inputs["Metallic"].default_value = 0.0 if key == "polyamide" else 0.8
            bsdf.inputs["Roughness"].default_value = 0.4
        mat.diffuse_color = (*c, 1.0)
    return mat


def cut_holes(obj, holes, col):
    """Отверстия: резцы-цилиндры (чуть длиннее) → Boolean DIFFERENCE → применённая сетка."""
    bm = bmesh.new()
    eps = 1.0
    for h in holes:
        depth = h["z1"] - h["z0"] + 2 * eps
        m = Matrix.Translation(Vector((h["x"], h["y"], (h["z0"] + h["z1"]) / 2.0)))
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=HOLE_SEGMENTS,
                              radius1=h["d"] / 2.0, radius2=h["d"] / 2.0, depth=depth, matrix=m)
    cutter = mesh_object(obj.name + "_cutter", bm, col)
    mod = obj.modifiers.new("BuildSense_holes", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cutter
    solvers = [i.identifier for i in bpy.types.BooleanModifier.bl_rna.properties["solver"].enum_items]
    mod.solver = "EXACT" if "EXACT" in solvers else solvers[0]
    solver = mod.solver
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    new_me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    old = obj.data
    obj.modifiers.remove(mod)
    obj.data = new_me
    bpy.data.meshes.remove(old)
    cme = cutter.data
    bpy.data.objects.remove(cutter, do_unlink=True)
    bpy.data.meshes.remove(cme)
    return solver


def mesh_checks(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.transform(obj.matrix_world)
    non_manifold = sum(1 for e in bm.edges if not e.is_manifold)
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    volume = bm.calc_volume(signed=True)
    xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]; zs = [v.co.z for v in bm.verts]
    res = {
        "verts": len(bm.verts), "edges": len(bm.edges), "faces": len(bm.faces),
        "non_manifold": non_manifold, "boundary": boundary, "volume": volume,
        "euler": len(bm.verts) - len(bm.edges) + len(bm.faces),
        "bbox_min": [min(xs), min(ys), min(zs)], "bbox_max": [max(xs), max(ys), max(zs)],
    }
    bm.free()
    return res


def build(data, scene=None):
    scene = scene or bpy.context.scene
    units_before = set_mm_units(scene)
    col = get_collection(scene)
    report = []
    for part in data["parts"]:
        bm = revolve_bmesh(part["solid"]["revolve"]["profile"])
        obj = mesh_object(part.get("name") or part["id"], bm, col)
        obj["buildsense_id"] = part["id"]
        obj["buildsense_type"] = part["type"]
        obj["buildsense_params"] = json.dumps(part["params"], ensure_ascii=False)
        holes = part["solid"].get("holes") or []
        solver = None
        if holes:
            solver = cut_holes(obj, holes, col)
        obj.data.materials.append(material_for(part.get("material", "steel")))
        for poly in obj.data.polygons:
            poly.use_smooth = False
        obj.matrix_world = placement_matrix(part["placement"])
        bpy.context.view_layer.update()
        chk = mesh_checks(obj)
        analytic = part["analytic"]["volume"]
        bb_err = max(abs(a - b) for a, b in zip(chk["bbox_min"] + chk["bbox_max"], part["analytic"]["bboxMin"] + part["analytic"]["bboxMax"]))
        chk.update(name=obj.name, type=part["type"], analytic=analytic, deviation=(chk["volume"] - analytic) / analytic,
                   bbox_err=bb_err, boolean_solver=solver)
        report.append(chk)
    return {"units_before": units_before, "parts": report, "collection": col.name}


def export(col_name, out_dir, base):
    """STL и OBJ объектов коллекции (мм, Z вверх). Выделение пользователя восстанавливается."""
    os.makedirs(out_dir, exist_ok=True)
    col = bpy.data.collections[col_name]
    view_layer = bpy.context.view_layer
    prev_sel = [o for o in view_layer.objects if o.select_get()]
    prev_active = view_layer.objects.active
    for o in prev_sel:
        o.select_set(False)
    for o in col.objects:
        o.select_set(True)
    view_layer.objects.active = col.objects[0] if col.objects else None
    stl = os.path.join(out_dir, base + ".stl")
    obj_path = os.path.join(out_dir, base + ".obj")
    try:
        bpy.ops.wm.stl_export(filepath=stl, export_selected_objects=True, ascii_format=False, global_scale=1.0,
                              use_scene_unit=False, forward_axis="Y", up_axis="Z", apply_modifiers=True)
        bpy.ops.wm.obj_export(filepath=obj_path, export_selected_objects=True, global_scale=1.0,
                              forward_axis="Y", up_axis="Z", apply_modifiers=True, export_materials=False,
                              export_uv=False, export_triangulated_mesh=True)
    finally:
        for o in col.objects:
            o.select_set(False)
        for o in prev_sel:
            o.select_set(True)
        view_layer.objects.active = prev_active
    return stl, obj_path


def build_from_file(json_path, out_dir=None):
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if data.get("format") != "buildsense-mech-freecad" or data.get("units") != "mm":
        raise ValueError("ожидался экспорт buildsense-mech-freecad в мм")
    result = build(data)
    if out_dir:
        base = os.path.splitext(os.path.splitext(os.path.basename(json_path))[0])[0]
        result["stl"], result["obj"] = export(result["collection"], out_dir, base + "_blender")
    return result


def format_report(result):
    lines = []
    for r in result["parts"]:
        lines.append("%-26s V=%.3f аналит.=%.3f откл.=%+.4f%% неманиф.=%d гранич.=%d χ=%d габарит±%.4f мм" % (
            r["name"], r["volume"], r["analytic"], r["deviation"] * 100, r["non_manifold"], r["boundary"], r["euler"], r["bbox_err"]))
    return "\n".join(lines)


if __name__ == "__main__" and "--" in sys.argv:
    args = sys.argv[sys.argv.index("--") + 1:]
    res = build_from_file(args[0], args[1] if len(args) > 1 else None)
    print(format_report(res))
