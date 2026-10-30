# -*- coding: utf-8 -*-
"""Проверка freecad/import_parts.FCMacro в настоящем FreeCAD (консольный freecadcmd).

  "C:/Program Files/FreeCAD 1.1/bin/freecadcmd.exe" tests/mech_freecad_test.py

Переменные окружения (необязательно):
  BUILDSENSE_MECH_TMP — папка для .FCStd/.step (по умолчанию системная временная);
  BUILDSENSE_MECH_STL — список STL (через ;) для проверки Mesh: замкнутость и объём;
  BUILDSENSE_MECH_STL_VOLUME — ожидаемый суммарный объём STL, мм³ (допуск 0,5 %);
  BUILDSENSE_MECH_EXTRA — дополнительные *.mech-freecad.json (через ;), например из tests/mech_assembly_audit.test.js.

Проверяется для examples/mech/demo.mech-freecad.json, examples/mech/assembly.mech-freecad.json
и tests/mech_variants.freecad.json:
  * каждое тело isValid(), одно тело (Solid), объём = аналитический ± 0,5 %;
  * габарит BoundBox = аналитический габарит (± 0,01 мм) — значит, верен и поворот;
  * отверстия сквозные: ось отверстия не пересекает тело, расстояние от оси = радиус;
  * вал сплошной: ось пересекает тело на всю длину;
  * .FCStd сохраняется и открывается с теми же объёмами; STEP записывается и читается (Part.read)
    с тем же объёмом и числом тел.
"""

import json
import os
import sys
import tempfile
import traceback

import FreeCAD as App
import Part

try:  # консоль Windows (cp1251) не печатает «×», «⌀» и т. п.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FAILS = []
CHECKS = [0]


def check(cond, msg):
    CHECKS[0] += 1
    if not cond:
        FAILS.append(msg)
        print("  FAIL:", msg)


def load_macro():
    src = open(os.path.join(ROOT, "freecad", "import_parts.FCMacro"), encoding="utf-8").read()
    ns = {"__name__": "buildsense_mech_macro", "BUILDSENSE_MECH_NO_MAIN": True}
    os.environ.pop("BUILDSENSE_MECH_JSON", None)
    exec(compile(src, "import_parts.FCMacro", "exec"), ns)
    return ns


def world_line(part, p0, p1):
    pl = App.Placement(App.Vector(part["placement"]["x"], part["placement"]["y"], part["placement"]["z"]),
                       MACRO["rotation_xyz"](part["placement"].get("rotation", {})))
    return Part.makeLine(pl.multVec(App.Vector(*p0)), pl.multVec(App.Vector(*p1)))


def check_part(part, obj):
    name = part["name"]
    shape = obj.Shape
    analytic = part["analytic"]["volume"]
    dev = (shape.Volume - analytic) / analytic
    print("  %-28s V=%12.3f  аналит.=%12.3f  откл.=%+.5f %%  valid=%s solids=%d" % (name, shape.Volume, analytic, dev * 100, shape.isValid(), len(shape.Solids)))
    check(shape.isValid(), name + ": isValid() = False")
    check(len(shape.Solids) == 1, name + ": тел %d, ожидалось 1" % len(shape.Solids))
    check(abs(dev) <= 0.005, name + ": отклонение объёма %.4f %%" % (dev * 100))
    bb = shape.BoundBox
    got = [bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax]
    exp = part["analytic"]["bboxMin"] + part["analytic"]["bboxMax"]
    err = max(abs(a - b) for a, b in zip(got, exp))
    check(err < 0.01, name + ": габарит отличается на %.4f мм" % err)
    p = part["params"]
    if part["type"] in ("bushing", "flange"):
        top = max(z for _, z in part["solid"]["revolve"]["profile"])
        axis = world_line(part, (0, 0, -5), (0, 0, top + 5))
        d = shape.distToShape(axis)[0]
        check(abs(d - p["d"] / 2.0) < 1e-6, name + ": расстояние от оси до тела %.6f, ожидалось %.6f" % (d, p["d"] / 2.0))
        check(shape.common(axis).Length < 1e-9, name + ": ось пересекает тело — отверстие не сквозное")
    for h in part["solid"]["holes"]:
        axis = world_line(part, (h["x"], h["y"], h["z0"] - 5), (h["x"], h["y"], h["z1"] + 5))
        d = shape.distToShape(axis)[0]
        check(abs(d - h["d"] / 2.0) < 1e-6, name + ": отверстие (%.2f, %.2f): расстояние %.6f" % (h["x"], h["y"], d))
        check(shape.common(axis).Length < 1e-9, name + ": отверстие не сквозное")
    if part["type"] == "shaft":
        length = sum(s["L"] for s in p["steps"])
        axis = world_line(part, (0, 0, -5), (0, 0, length + 5))
        inside = shape.common(axis).Length
        check(abs(inside - length) < 1e-6, name + ": ось внутри тела %.6f мм, ожидалось %.6f" % (inside, length))


def run_file(path, tmp):
    print("Файл:", os.path.relpath(path, ROOT))
    data = MACRO["load"](path)
    doc, report = MACRO["build_document"](data)
    for r in report:
        check(not r.get("error"), "%s: ошибка построения %s" % (r.get("name"), r.get("error")))
    objs = {o.BuildSenseId: o for o in doc.Objects if "BuildSenseId" in o.PropertiesList}
    for part in data["parts"]:
        check(part["id"] in objs, part["name"] + ": объект не создан")
        if part["id"] in objs:
            check_part(part, objs[part["id"]])
            mass = objs[part["id"]].BuildSenseMassKg
            check(abs(mass - part["analytic"]["mass"]) / part["analytic"]["mass"] < 0.005, part["name"] + ": масса %.4f кг" % mass)
    base = os.path.join(tmp, os.path.splitext(os.path.basename(path))[0].replace(".", "_"))
    fcstd = base + ".FCStd"
    doc.saveAs(fcstd)
    vols = sorted(o.Shape.Volume for o in objs.values())
    App.closeDocument(doc.Name)
    doc2 = App.openDocument(fcstd)
    vols2 = sorted(o.Shape.Volume for o in doc2.Objects if "BuildSenseId" in o.PropertiesList)
    check(len(vols2) == len(vols) and all(abs(a - b) < 1e-6 * a for a, b in zip(vols, vols2)), "FCStd: объёмы после открытия отличаются")
    print("  FCStd: %s (%d байт), открыт заново, объёмы совпадают" % (os.path.basename(fcstd), os.path.getsize(fcstd)))
    step = base + ".step"
    MACRO["export_step"](doc2, step)
    check(os.path.exists(step) and os.path.getsize(step) > 0, "STEP не создан")
    back = Part.read(step)
    total = sum(vols)
    check(len(back.Solids) == len(vols), "STEP: тел %d, ожидалось %d" % (len(back.Solids), len(vols)))
    check(abs(back.Volume - total) / total < 1e-6, "STEP: объём %.3f против %.3f" % (back.Volume, total))
    check(back.isValid(), "STEP: тело после чтения невалидно")
    print("  STEP: %s (%d байт), Part.read: тел=%d, V=%.3f (в документе %.3f), откл.=%.2e" % (
        os.path.basename(step), os.path.getsize(step), len(back.Solids), back.Volume, total, (back.Volume - total) / total))
    if data.get("assemblies"):
        check_assemblies(data, doc2)
    App.closeDocument(doc2.Name)
    return total


def check_assemblies(data, doc):
    """Сборка после повторного открытия .FCStd: контейнер App::Part, отдельные тела, без пересечений, контакт граней."""
    parts = {p["id"]: p for p in data["parts"]}
    objs = {o.BuildSenseId: o for o in doc.Objects if "BuildSenseId" in o.PropertiesList}
    for asm in data["assemblies"]:
        conts = [o for o in doc.Objects if o.TypeId == "App::Part" and getattr(o, "BuildSenseAssemblyId", None) == asm["id"]]
        check(len(conts) == 1, "%s: контейнер App::Part не найден" % asm["name"])
        if not conts:
            continue
        cont = conts[0]
        inside = [o for o in cont.Group if "BuildSenseId" in o.PropertiesList]
        check(sorted(o.BuildSenseId for o in inside) == sorted(c["partId"] for c in asm["components"]), "%s: состав контейнера не совпадает" % asm["name"])
        check(len(json.loads(cont.BuildSenseMates)) == len(asm["mates"]), "%s: сопряжения не записаны" % asm["name"])
        check(asm["ok"] and cont.BuildSenseSolved, "%s: сборка не решена в BuildSense" % asm["name"])
        shapes = [(o.Label, o.Shape) for o in inside]
        worst = 0.0
        for i in range(len(shapes)):
            for j in range(i + 1, len(shapes)):
                v = shapes[i][1].common(shapes[j][1]).Volume
                worst = max(worst, v)
                check(v < 1e-3, "%s и %s пересекаются: %.4f мм³" % (shapes[i][0], shapes[j][0], v))
        print("  Сборка «%s»: App::Part %s, компонентов %d, сопряжений %d, наибольшее пересечение тел %.2e мм³" % (
            asm["name"], cont.Name, len(inside), len(asm["mates"]), worst))
        comp_part = {c["id"]: c["partId"] for c in asm["components"]}
        for m in asm["mates"]:
            if m["type"] == "coaxial":
                continue
            a, b = objs[comp_part[m["a"]["comp"]]], objs[comp_part[m["b"]["comp"]]]
            d = a.Shape.distToShape(b.Shape)[0]
            if m["type"] == "planar" and m["mode"] == "contact":
                check(d < 1e-6, "%s: тела не касаются (зазор %.6f мм)" % (m["label"], d))
                print("    %s: расстояние между телами %.2e мм (касание)" % (m["label"], d))
            else:
                # смещение: расстояние между плоскостями граней вдоль оси, из геометрии FreeCAD
                pa, pb = parts[comp_part[m["a"]["comp"]]], parts[comp_part[m["b"]["comp"]]]
                za = face_z(pa, m["a"]["ref"])
                zb = face_z(pb, m["b"]["ref"])
                axis = a.Placement.Rotation.multVec(App.Vector(0, 0, 1))
                qa = a.Placement.multVec(App.Vector(0, 0, za))
                qb = b.Placement.multVec(App.Vector(0, 0, zb))
                gap = abs((qb - qa).dot(axis))
                check(abs(gap - m["offset"]) < 1e-6, "%s: смещение %.6f мм, ожидалось %.6f" % (m["label"], gap, m["offset"]))
                print("    %s: смещение граней по FreeCAD %.6f мм" % (m["label"], gap))


def check_interference(path):
    """Пересечение, найденное решателем BuildSense по профилям, против common() ядра OpenCASCADE."""
    print("Файл:", os.path.relpath(path, ROOT))
    data = MACRO["load"](path)
    doc, _ = MACRO["build_document"](data)
    objs = {o.BuildSenseId: o for o in doc.Objects if "BuildSenseId" in o.PropertiesList}
    exp = data["expectedInterference"]
    check(len(exp) == 1, "ожидалось одно пересечение, в файле %d" % len(exp))
    for e in exp:
        v = objs[e["a"]].Shape.common(objs[e["b"]].Shape).Volume
        dev = (v - e["volume"]) / v
        print("  Пересечение %s / %s: BuildSense %.4f мм³, FreeCAD common() %.4f мм³, откл. %+.5f %%" % (
            objs[e["a"]].Label, objs[e["b"]].Label, e["volume"], v, dev * 100))
        check(abs(dev) < 0.005, "объём пересечения отличается на %.4f %%" % (dev * 100))
    pairs = {tuple(sorted((e["a"], e["b"]))) for e in exp}
    ids = sorted(objs)
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            if (ids[i], ids[j]) not in pairs:
                v = objs[ids[i]].Shape.common(objs[ids[j]].Shape).Volume
                check(v < 1e-3, "%s / %s: пересечение %.4f мм³, решатель его не нашёл" % (ids[i], ids[j], v))
    App.closeDocument(doc.Name)


def face_z(part, ref):
    p = part["params"]
    if ref == "end0":
        return 0.0
    if part["type"] == "shaft":
        if ref == "end1":
            return float(sum(s["L"] for s in p["steps"]))
        i = int(ref[4:])
        return float(sum(s["L"] for s in p["steps"][:i]))
    if part["type"] == "bushing":
        return float(p["L"])
    if part["type"] in ("link", "block"):
        return float(p["T"])
    if part["type"] == "piston":
        return float(p["H"])
    if part["type"] == "screw":
        return float({"head0": p["Lt"], "head1": p["Lt"] + p["Lh"]}.get(ref, p["Lt"] + p["Lh"] + p["Ln"]))
    if ref == "disk":
        return float(p["T"])
    return float(p["T"] + (p["hubH"] if p["hubD"] > 0 and p["hubH"] > 0 else 0))


def check_stl(paths, expected):
    import Mesh

    total = 0.0
    for p in paths:
        m = Mesh.Mesh(p)
        comps = m.getSeparateComponents() if hasattr(m, "getSeparateComponents") else [m]
        print("STL %s: треугольников=%d, isSolid=%s, nonManifolds=%s, компонент=%d, V=%.3f" % (
            os.path.basename(p), m.CountFacets, m.isSolid(), m.hasNonManifolds(), len(comps), m.Volume))
        check(m.isSolid(), os.path.basename(p) + ": Mesh.isSolid() = False")
        check(not m.hasNonManifolds(), os.path.basename(p) + ": есть неманифолдные рёбра")
        total += m.Volume
        # оболочка → твёрдое тело (только для проверки; это всё ещё фасетная геометрия)
        for i, c in enumerate(comps):
            sh = Part.Shape()
            sh.makeShapeFromMesh(c.Topology, 0.01)
            solid = Part.makeSolid(Part.Shell(sh.Faces))
            check(solid.isValid() and abs(solid.Volume - c.Volume) < 1e-3 * abs(c.Volume), "%s: компонент %d → Part.Solid не совпал" % (os.path.basename(p), i))
    if expected:
        dev = (total - expected) / expected
        print("STL суммарно: V=%.3f, ожидалось %.3f, откл.=%+.4f %%" % (total, expected, dev * 100))
        check(abs(dev) <= 0.005, "STL: объём отличается на %.4f %%" % (dev * 100))


def main():
    tmp = os.environ.get("BUILDSENSE_MECH_TMP") or tempfile.mkdtemp(prefix="bs_mech_")
    os.makedirs(tmp, exist_ok=True)
    print("FreeCAD", ".".join(App.Version()[:3]), "| временная папка:", tmp)
    for f in (os.path.join(ROOT, "examples", "mech", "demo.mech-freecad.json"), os.path.join(ROOT, "examples", "mech", "assembly.mech-freecad.json"),
              os.path.join(HERE, "mech_variants.freecad.json"),
              *[os.path.join(ROOT, "examples", "mech", "showcase-%s.mech-freecad.json" % d) for d in ("shaft-supports", "engine", "screw-jack")]):
        run_file(f, tmp)
    check_interference(os.path.join(HERE, "mech_interference.freecad.json"))
    for extra in [p for p in os.environ.get("BUILDSENSE_MECH_EXTRA", "").split(";") if p]:
        run_file(extra, tmp)
    stl = [p for p in os.environ.get("BUILDSENSE_MECH_STL", "").split(";") if p]
    if stl:
        check_stl(stl, float(os.environ.get("BUILDSENSE_MECH_STL_VOLUME") or 0))


try:
    MACRO = load_macro()
    main()
except Exception:
    traceback.print_exc()
    FAILS.append("исключение")
print("RESULT: %s (%d проверок, %d ошибок)" % ("PASS" if not FAILS else "FAIL", CHECKS[0], len(FAILS)))
sys.stdout.flush()
os._exit(0 if not FAILS else 1)
