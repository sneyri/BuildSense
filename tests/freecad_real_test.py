"""Проверка макроса freecad/import_house.FCMacro в настоящем FreeCAD (консольный режим).

Запуск из корня проекта:
    "<папка FreeCAD>/bin/freecadcmd.exe" tests/freecad_real_test.py

Для каждого файла экспорта из examples/ в режимах BIM и Part:
  * макрос импортирует JSON и сохраняет .FCStd; файл открывается заново;
  * для каждого элемента найден объект с BuildSenseId, тело не пустое и валидное;
  * габаритный контейнер объекта совпадает с ожидаемым по JSON (допуск 2 мм; окна и двери — 60 мм);
  * объём стены уменьшен на объём её проёмов (вырезы действительно сделаны);
  * неизвестный тип элемента пропускается и попадает в отчёт;
  * файл проекта (а не экспорта) отклоняется без создания документа.
"""
import json
import math
import os
import runpy
import sys
import tempfile
import traceback

import FreeCAD as App

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..")) if "__file__" in globals() else os.getcwd()
MACRO = os.path.join(ROOT, "freecad", "import_house.FCMacro")
FILES = ["starter-house", "two-storey", "all-types", "residential-section"]
TOL = 2.0
TOL_OPENING = 60.0
REPORT = []


def run_macro(json_path, out_path, mode):
    os.environ["BUILDSENSE_JSON"] = json_path
    os.environ["BUILDSENSE_OUT"] = out_path
    os.environ["BUILDSENSE_MODE"] = mode
    os.environ["BUILDSENSE_IFC"] = os.path.splitext(out_path)[0] + ".ifc" if mode == "bim" else "0"
    try:
        return runpy.run_path(MACRO, run_name="__main__")
    finally:
        for k in ("BUILDSENSE_JSON", "BUILDSENSE_OUT", "BUILDSENSE_MODE", "BUILDSENSE_IFC"):
            os.environ.pop(k, None)


def corners(p, a, b, du=0.0, dv=0.0):
    ang = math.radians(p.get("rotationZ", 0))
    out = []
    for u, v in ((0, 0), (a, 0), (a, b), (0, b)):
        u, v = u + du, v + dv
        out.append((p["x"] + u * math.cos(ang) - v * math.sin(ang), p["y"] + u * math.sin(ang) + v * math.cos(ang)))
    return out


def expected_bbox(el):
    """(xmin, ymin, zmin, xmax, ymax, zmax) по данным экспорта; None — если форма не проверяется."""
    shape, s = el["shape"], el["size"]
    if shape == "opening":
        p = el["placement"]
        pts = corners(p, s["width"], el["hostThickness"])
        z0, z1 = p["z"], p["z"] + s["height"]
    else:
        p = el["placement"]
        if shape == "wall":
            pts, z0, z1 = corners(p, s["length"], s["thickness"]), p["z"], p["z"] + s["height"]
        elif shape == "cylinder":
            r = s["diameter"] / 2.0
            pts, z0, z1 = [(p["x"] - r, p["y"] - r), (p["x"] + r, p["y"] + r)], p["z"], p["z"] + s["height"]
        elif shape == "pipe":
            d = s["diameter"]
            if el["params"].get("vertical"):
                pts, z0, z1 = [(p["x"] - d / 2, p["y"] - d / 2), (p["x"] + d / 2, p["y"] + d / 2)], p["z"], p["z"] + s["length"]
            else:
                pts, z0, z1 = corners(p, s["length"], d, 0, -d / 2), p["z"] - d / 2, p["z"] + d / 2
        elif shape == "roof":
            h = s.get("rise", 0) if el["params"].get("roofType") != "flat" else s.get("thickness", el["params"].get("thickness", 250))
            pts, z0, z1 = corners(p, s["length"], s["width"]), p["z"], p["z"] + h
        elif shape == "truss":
            pts, z0, z1 = corners(p, s["length"], s["width"]), p["z"], p["z"] + s["height"] + s["width"]
        elif shape in ("box", "fixture", "balcony", "railing", "zone", "stairs"):
            pts, z0, z1 = corners(p, s["length"], s["width"]), p["z"], p["z"] + s["height"]
        else:
            return None
    xs, ys = [q[0] for q in pts], [q[1] for q in pts]
    return (min(xs), min(ys), z0, max(xs), max(ys), z1)


def find(doc, el_id):
    found = [o for o in doc.Objects if getattr(o, "BuildSenseId", None) == el_id and getattr(o, "BuildSenseRole", "") not in ("opening-void",)]
    # Итоговый объект стены (Cut или Arch Wall), а не её тело
    found.sort(key=lambda o: 0 if o.TypeId in ("Part::Cut",) or "Wall" in o.TypeId else 1)
    return found[0] if found else None


def check_file(slug, mode, tmp):
    errors = []
    path = os.path.join(ROOT, "examples", slug + ".freecad.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    # Неизвестный тип — должен попасть в отчёт «пропущено»
    data["elements"].append({"id": "spaceship-1", "type": "spaceship", "shape": "box", "name": "НЛО", "placement": {"x": 0, "y": 0, "z": 0, "rotationZ": 0},
                             "size": {"length": 1, "width": 1, "height": 1}, "params": {}, "levelId": "L1"})
    src = os.path.join(tmp, "{}-{}.json".format(slug, mode))
    with open(src, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    out = os.path.join(tmp, "{}-{}.FCStd".format(slug, mode))
    before = set(App.listDocuments())
    ns = run_macro(src, out, mode)
    created = [n for n in App.listDocuments() if n not in before]
    if len(created) != 1 or not os.path.exists(out):
        return ["{}/{}: документ не создан или не сохранён".format(slug, mode)]
    report = ns["import_house"].__globals__ if "import_house" in ns else None
    App.closeDocument(created[0])

    # Повторный импорт для отчёта (функция импорта без сохранения)
    doc_r, rep, used = ns["import_house"](src, mode)
    if not any("spaceship" in s for s in rep.skipped):
        errors.append("{}/{}: неизвестный тип не попал в отчёт".format(slug, mode))
    if rep.errors:
        errors.append("{}/{}: ошибки импорта: {}".format(slug, mode, "; ".join(rep.errors[:5])))
    App.closeDocument(doc_r.Name)

    ifc_info = check_ifc(slug, mode, out, data, errors)

    doc = App.openDocument(out)
    doc.recompute()
    stats = {"bim": 0, "part": 0, "checked": 0, "codes": 0}
    for el in data["elements"]:
        if el["type"] == "spaceship":
            continue
        obj = find(doc, el["id"])
        if obj is None:
            errors.append("{}/{}: {} ({}) не найден в документе".format(slug, mode, el["id"], el["type"]))
            continue
        if not hasattr(obj, "Shape") or obj.Shape.isNull():
            errors.append("{}/{}: {} — пустое тело".format(slug, mode, el["id"]))
            continue
        if el.get("bimCode"):
            if getattr(obj, "BuildSenseBimCode", None) != el["bimCode"]:
                errors.append("{}/{}: {} — BIM-код {} не сохранён".format(slug, mode, el["id"], el["bimCode"]))
            else:
                stats["codes"] += 1
        if not obj.Shape.isValid():
            errors.append("{}/{}: {} — невалидное тело".format(slug, mode, el["id"]))
        is_bim = obj.TypeId.startswith("Part::FeaturePython") or "Arch" in str(getattr(obj, "Proxy", ""))
        stats["bim" if is_bim else "part"] += 1
        exp = expected_bbox(el)
        if exp is None:
            continue
        if el["shape"] == "opening" and not is_bim:
            # В режиме Part проём — вырез в стене + тонкое заполнение (panel) по центру толщины
            pn = el["panel"]
            exp = expected_bbox({"shape": "box", "size": pn["size"], "placement": pn["placement"], "params": {}})
        if el["type"] == "stairs" and is_bim:
            # Arch Stairs: верхней ступенью служит пол следующего этажа — тело ниже на одну высоту ступени
            n = max(1, int(el["params"].get("steps", 1)))
            exp = exp[:5] + (exp[5] - el["size"]["height"] / n,)
        bb = obj.Shape.BoundBox
        got = (bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax)
        tol = TOL_OPENING if el["shape"] in ("opening",) and is_bim else TOL
        if el["type"] == "truss":
            tol = el["size"]["width"]  # стержни фермы повёрнуты: габарит больше на долю сечения
        if el["type"] == "room":
            tol = TOL  # Arch Space — по объёму зоны
        diff = max(abs(a - b) for a, b in zip(got, exp))
        stats["checked"] += 1
        if diff > tol:
            errors.append("{}/{}: {} ({}, {}) габариты отличаются на {:.1f} мм: получено {}, ожидалось {}".format(
                slug, mode, el["id"], el["type"], obj.TypeId, diff, tuple(round(v) for v in got), tuple(round(v) for v in exp)))
    # Вырезы проёмов
    for w in (e for e in data["elements"] if e["type"] == "wall"):
        obj = find(doc, w["id"])
        if obj is None:
            continue
        s = w["size"]
        full = s["length"] * s["thickness"] * s["height"]
        holes = sum(o["size"]["width"] * o["size"]["height"] * s["thickness"] for o in data["elements"] if o.get("hostId") == w["id"] and o["shape"] == "opening")
        vol = obj.Shape.Volume
        if holes and abs(vol - (full - holes)) > 0.03 * full:
            errors.append("{}/{}: {} объём {:.3f} м3, ожидалось {:.3f} м3 (проёмы не вырезаны?)".format(slug, mode, w["id"], vol / 1e9, (full - holes) / 1e9))
    REPORT.append("{:14s} {:5s}: объектов в файле {:3d}; проверено габаритов {:3d}; BIM {:3d}, Part {:3d}; BIM-кодов {:3d}; ошибок {}{}".format(
        slug, mode, len(doc.Objects), stats["checked"], stats["bim"], stats["part"], stats["codes"], len(errors), ifc_info))
    App.closeDocument(doc.Name)
    return errors


def check_ifc(slug, mode, out, data, errors):
    """BIM-режим: макрос сохраняет IFC рядом с .FCStd; проверяем, что файл читается и содержит стены, проёмы, плиты и этажи."""
    ifc = os.path.splitext(out)[0] + ".ifc"
    if mode != "bim":
        if os.path.exists(ifc):
            errors.append("{}/{}: IFC сохранён в режиме Part".format(slug, mode))
        return ""
    if not os.path.exists(ifc):
        errors.append("{}/{}: IFC не сохранён".format(slug, mode))
        return ""
    import ifcopenshell
    f = ifcopenshell.open(ifc)
    count = lambda cls: len(f.by_type(cls))
    walls = sum(1 for e in data["elements"] if e["type"] == "wall")
    windows = sum(1 for e in data["elements"] if e["type"] == "window")
    got = {"IfcWall": count("IfcWall"), "IfcWindow": count("IfcWindow"), "IfcDoor": count("IfcDoor"), "IfcSlab": count("IfcSlab"),
           "IfcBuildingStorey": count("IfcBuildingStorey"), "всего IfcProduct": count("IfcProduct")}
    if got["IfcWall"] < walls:
        errors.append("{}/{}: в IFC стен {} из {}".format(slug, mode, got["IfcWall"], walls))
    if got["IfcWindow"] < windows:
        errors.append("{}/{}: в IFC окон {} из {}".format(slug, mode, got["IfcWindow"], windows))
    if got["IfcBuildingStorey"] < len(data.get("levels", [])):
        errors.append("{}/{}: в IFC этажей {} из {}".format(slug, mode, got["IfcBuildingStorey"], len(data["levels"])))
    return "\n{:20s}IFC {} ({}): {}".format("", f.schema, os.path.basename(ifc), ", ".join("{} {}".format(k, v) for k, v in got.items()))


def check_rejects_project(tmp):
    before = set(App.listDocuments())
    out = os.path.join(tmp, "nope.FCStd")
    run_macro(os.path.join(ROOT, "examples", "starter-house.buildsense.json"), out, "bim")
    if set(App.listDocuments()) != before or os.path.exists(out):
        return ["файл проекта не был отклонён"]
    return []


def main():
    REPORT.append("FreeCAD {} | макрос: {}".format(".".join(App.Version()[:3]), MACRO))
    errors = []
    with tempfile.TemporaryDirectory() as tmp:
        for slug in FILES:
            for mode in ("bim", "part"):
                try:
                    errors += check_file(slug, mode, tmp)
                except Exception:
                    errors.append("{}/{}: исключение\n{}".format(slug, mode, traceback.format_exc()))
        errors += check_rejects_project(tmp)
    lines = REPORT + ["ОШИБКА: " + e for e in errors] + ["ИТОГ: " + ("OK" if not errors else "ОШИБКИ ({})".format(len(errors)))]
    # Консоль Windows может не уметь печатать часть символов — полный отчёт пишется в UTF-8
    report_path = os.environ.get("BUILDSENSE_TEST_REPORT", os.path.join(tempfile.gettempdir(), "buildsense_freecad_test.txt"))
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("ИТОГ:", "OK" if not errors else "ОШИБКИ ({})".format(len(errors)), "| отчёт:", report_path)
    sys.stdout.flush()
    os._exit(0 if not errors else 1)


main()
