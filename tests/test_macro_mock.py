"""Проверка управляющей логики макроса freecad/import_house.FCMacro без установленного FreeCAD.

Модули FreeCAD и Part заменяются заглушками; модуль Arch отсутствует, поэтому макрос работает
в режиме Part. Проверяется: каждый поддерживаемый элемент создаёт объект с BuildSenseId,
неизвестный тип попадает в отчёт, файл проекта отклоняется, результат сохраняется.
Геометрию проверяет tests/freecad_real_test.py в настоящем FreeCAD.

Запуск:  python tests/test_macro_mock.py
"""
import json
import os
import runpy
import sys
import tempfile
import types
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MACRO = os.path.join(ROOT, "freecad", "import_house.FCMacro")
EXPORTS = ["starter-house", "two-storey", "all-types", "l-house", "t-house-strip"]


class Vector:
    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x, self.y, self.z = float(x), float(y), float(z)


class Rotation:
    def __init__(self, *a):
        self.args = a

    def multiply(self, other):
        return Rotation(self, other)

    def toEuler(self):
        return (0.0, 0.0, 0.0)


class Placement:
    def __init__(self, base=None, rotation=None):
        self.Base = base or Vector()
        self.Rotation = rotation or Rotation()

    def multiply(self, other):
        return Placement(self.Base, self.Rotation)

    def multVec(self, v):
        return v


class Shape:
    """Заглушка формы: поддерживает операции, которые вызывает макрос в режиме Part."""
    BoundBox = types.SimpleNamespace(XMin=0, YMin=0, ZMin=0, XMax=1, YMax=1, ZMax=1)

    def __init__(self, *a, **k):
        self.Placement = Placement()

    def isNull(self):
        return False

    def isValid(self):
        return True

    def fuse(self, *a):
        return Shape()

    def removeSplitter(self):
        return self

    def rotate(self, *a):
        return self

    def translate(self, *a):
        return self

    def extrude(self, *a):
        return Shape()


class DocObject:
    def __init__(self, doc, type_id, name):
        object.__setattr__(self, "PropertiesList", ["Label", "Placement"])
        self.Document, self.TypeId, self.Name, self.Label = doc, type_id, name, name
        self.Shape = Shape()
        self.Group = []
        self.State = []

    def addProperty(self, kind, name, group, doc):
        self.PropertiesList.append(name)

    def addObject(self, obj):
        self.Group.append(obj)


class Document:
    def __init__(self, name):
        self.Name, self.Label, self.Objects, self.saved_to = name, name, [], None

    def addObject(self, type_id, name):
        names = {o.Name for o in self.Objects}
        n, i = name, 1
        while n in names:
            n, i = "{}{:03d}".format(name, i), i + 1
        obj = DocObject(self, type_id, n)
        self.Objects.append(obj)
        return obj

    def removeObject(self, name):
        self.Objects = [o for o in self.Objects if o.Name != name]

    def recompute(self):
        pass

    def saveAs(self, path):
        with open(path, "w", encoding="utf-8") as f:
            f.write("stub")
        self.saved_to = path


def install_stubs():
    created = []
    app = types.ModuleType("FreeCAD")
    app.Vector, app.Rotation, app.Placement = Vector, Rotation, Placement
    app.GuiUp = False
    app.Console = types.SimpleNamespace(PrintMessage=lambda m: None, PrintWarning=lambda m: None, PrintError=lambda m: None)

    def new_document(name="Unnamed"):
        d = Document(name)
        created.append(d)
        return d
    app.newDocument = new_document
    part = types.ModuleType("Part")
    part.makeBox = lambda *a, **k: Shape()
    part.makePolygon = lambda *a, **k: Shape()
    part.Face = part.Shell = part.Solid = lambda *a, **k: Shape()
    part.makeCompound = lambda *a, **k: Shape()
    sys.modules["FreeCAD"] = app
    sys.modules["Part"] = part
    sys.modules.pop("Arch", None)
    return created


class MacroTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def run_macro(self, json_path):
        created = install_stubs()
        out = os.path.join(self.tmp.name, "out.FCStd")
        os.environ.update(BUILDSENSE_JSON=json_path, BUILDSENSE_OUT=out, BUILDSENSE_MODE="part")
        try:
            ns = runpy.run_path(MACRO, run_name="__main__")
        finally:
            for k in ("BUILDSENSE_JSON", "BUILDSENSE_OUT", "BUILDSENSE_MODE"):
                os.environ.pop(k, None)
        return created, out, ns

    def test_every_element_is_created_and_saved(self):
        for slug in EXPORTS:
            path = os.path.join(ROOT, "examples", slug + ".freecad.json")
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            created, out, _ = self.run_macro(path)
            self.assertEqual(len(created), 1, slug)
            doc = created[0]
            self.assertTrue(os.path.exists(out), slug)
            ids = {getattr(o, "BuildSenseId", None) for o in doc.Objects}
            for el in data["elements"]:
                self.assertIn(el["id"], ids, "{}: {} ({})".format(slug, el["id"], el["type"]))

    def test_unknown_type_is_reported(self):
        path = os.path.join(ROOT, "examples", "starter-house.freecad.json")
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        data["elements"].append({"id": "ufo-1", "type": "ufo", "shape": "box", "name": "НЛО", "levelId": "L1",
                                 "placement": {"x": 0, "y": 0, "z": 0, "rotationZ": 0}, "size": {"length": 1, "width": 1, "height": 1}, "params": {}})
        src = os.path.join(self.tmp.name, "with-ufo.json")
        with open(src, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        _, _, ns = self.run_macro(src)
        install_stubs()
        doc, report, mode = ns["import_house"](src, "part")
        self.assertEqual(mode, "part")
        self.assertTrue(any("ufo" in s for s in report.skipped))
        self.assertEqual(report.errors, [])

    def test_rejects_project_file(self):
        created, out, _ = self.run_macro(os.path.join(ROOT, "examples", "starter-house.buildsense.json"))
        self.assertEqual(created, [])
        self.assertFalse(os.path.exists(out))


if __name__ == "__main__":
    unittest.main(verbosity=2)
