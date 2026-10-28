from PIL import Image

from sim.config import load_factory
from sim.generator import generate
from sim.render import render_case_documents
from sim.scenarios import build_scenario

CFG = load_factory()


def test_every_visual_document_is_rendered_with_line_boxes(tmp_path):
    c = generate(build_scenario("aerators_down", 3, CFG, photo=True, lab=True, adversarial=True), CFG)
    render_case_documents(c, tmp_path)
    for doc in c.documents:
        if doc.type == "operator_statement":
            assert doc.image is None
            continue
        img = Image.open(tmp_path / doc.image)
        assert img.size[0] > 800
    log = next(d for d in c.documents if d.type == "logbook")
    assert len(log.meta["lines"]) == len(log.content["entries"])
    boxes = [line["box"] for line in log.meta["lines"]]
    assert all(0 <= b["x_min"] < b["x_max"] <= 1000 and 0 <= b["y_min"] < b["y_max"] <= 1000 for b in boxes)
    # entries are written top to bottom
    assert [b["y_min"] for b in boxes] == sorted(b["y_min"] for b in boxes)


def test_rendering_is_deterministic(tmp_path):
    c1 = generate(build_scenario("maintenance", 9, CFG), CFG)
    c2 = generate(build_scenario("maintenance", 9, CFG), CFG)
    render_case_documents(c1, tmp_path / "a")
    render_case_documents(c2, tmp_path / "b")
    assert c1.documents[0].meta["lines"] == c2.documents[0].meta["lines"]
