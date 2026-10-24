"""Render QA thumbnails from the saved authoring scene, without changing it.

blender --background assets/vehicles/berlin-vehicle-fleet.blend --python
scripts/blender/render_vehicles.py -- --root <repository>
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def render_previews(root, only=None):
    catalog = json.loads((root / "public/models/vehicles/catalog.json").read_text(encoding="utf-8"))
    scene = next(scene for scene in bpy.data.scenes if scene.get("berlinVehiclePack"))
    if bpy.context.window:
        bpy.context.window.scene = scene
    previews = root / "public/models/vehicles/previews"
    previews.mkdir(parents=True, exist_ok=True)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 480
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = True
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studiolight_rotate_z = .45
    scene.display.shading.color_type = "VERTEX"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "BOTH"
    scene.display.shading.curvature_ridge_factor = 1.1
    scene.display.shading.curvature_valley_factor = .8
    scene.display.shading.show_specular_highlight = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = .8
    scene.view_settings.gamma = 1
    camera_data = bpy.data.cameras.new("QA camera")
    camera = bpy.data.objects.new("QA camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = "ORTHO"
    records = []
    for model in catalog["models"]:
        if only and model["id"] not in only:
            continue
        for collection in scene.collection.children:
            collection.hide_render = not collection.name.startswith(model["id"] + ".") and collection.name != model["id"]
        asset = next(obj for obj in scene.objects if obj.get("modelId") == model["id"])
        asset.location = (0, 0, 0)
        asset.rotation_euler = (0, 0, 0)
        asset.scale = (1, 1, 1)
        meshes = [obj for obj in asset.children if obj.type == "MESH"]
        # A leading two-car detail makes the noses readable on long-distance
        # assets. Catalog and downloadable GLBs always contain the full consist.
        detail = model["dimensions"]["length"] > 115
        if detail:
            meshes = sorted(meshes, key=lambda obj: obj.get("segmentIndex", 0))[:2]
        for obj in asset.children:
            obj.hide_render = obj not in meshes
        bpy.context.view_layer.update()
        points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
        low = Vector(tuple(min(point[i] for point in points) for i in range(3)))
        high = Vector(tuple(max(point[i] for point in points) for i in range(3)))
        target = (low + high) / 2
        direction = Vector((1.18, -1.0, .84)).normalized()
        camera.location = target + direction * 160
        camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
        camera_matrix = camera.rotation_euler.to_matrix()
        right = camera_matrix @ Vector((1, 0, 0))
        up = camera_matrix @ Vector((0, 1, 0))
        projected_x = [right.dot(point - target) for point in points]
        projected_y = [up.dot(point - target) for point in points]
        camera_data.ortho_scale = max((max(projected_y) - min(projected_y)) * 2,
                                      max(projected_x) - min(projected_x)) * 1.22
        destination = previews / f"{model['id']}.png"
        scene.render.filepath = str(destination)
        bpy.ops.render.render(write_still=True)
        records.append({"id": model["id"], "detail": detail,
                        "shownCars": len(meshes), "totalCars": model["cars"]})
    (previews / "views.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"rendered": len(records), "directory": str(previews)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--only", nargs="*")
    options = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    render_previews(options.root.resolve(), options.only)
