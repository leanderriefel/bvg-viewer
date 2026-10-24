"""Turn the isolated scene library into an ordinary, directly openable .blend.

Runs in a separate background Blender so the live user's file and other scenes
are never included in the distributed authoring file.
"""

import sys
from pathlib import Path

import bpy
from mathutils import Vector


scene = next(scene for scene in bpy.data.scenes if scene.get("berlinVehiclePack"))
if bpy.context.window:
    bpy.context.window.scene = scene
camera_data = bpy.data.cameras.new("Fleet overview camera")
camera = bpy.data.objects.new("Fleet overview camera", camera_data)
scene.collection.objects.link(camera)
camera.location = (155, -320, 320)
camera.rotation_euler = (Vector((0, -126, 0)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera_data.type = "ORTHO"
camera_data.ortho_scale = 350
scene.camera = camera
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "VERTEX"
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = "BOTH"
scene.world.color = (.19, .21, .23)
# The only other scene created by opening a library is an empty startup scene.
for other in tuple(bpy.data.scenes):
    if other != scene and not other.objects:
        bpy.data.scenes.remove(other)
destination = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
bpy.ops.wm.save_as_mainfile(filepath=str(destination), compress=True, check_existing=False)
