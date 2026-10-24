"""Original Berlin fleet geometry. Run inside Blender; no downloaded meshes/textures.

Blender coordinates: metres, Z up, -Y forward. glTF export converts to Y up,
+Z forward. Each rigid car is one vertex-coloured mesh / one draw call.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector


SCENE_NAME = "Berlin Vehicle Fleet"
MATERIAL_NAME = "Berlin fleet · vertex colors"
PALETTES = {
    "sbahn": ("#E7BF54", "#982E3D", "#F0CF6B", "#AEB6BA"),
    "bvg": ("#F4CB16", "#F4CB16", "#F4CB16", "#B2B5B5"),
    "db": ("#D72D35", "#D72D35", "#E9ECE9", "#929CA3"),
    "odeg": ("#EDF0E9", "#5B9434", "#F6D436", "#BBC1BA"),
    "neb": ("#E7EDF0", "#27639C", "#F2CD30", "#A6B1BA"),
    "ice": ("#F2F2E9", "#D6313C", "#DDE1DD", "#AAB0AE"),
    "pkp": ("#EBECE8", "#213D64", "#E2E8EB", "#A3ACB3"),
    "cd": ("#E6EDF1", "#2365A2", "#2365A2", "#ADB9C3"),
    "srs": ("#F2E9C8", "#3E7452", "#D6DFC8", "#A8B5A7"),
    "woltersdorf": ("#F2E9CF", "#4D7952", "#E5DFC0", "#A5AEA3"),
    "vip": ("#EEEFE8", "#C92B36", "#D32F3A", "#AFB3AF"),
    "heritage": ("#EAD6A1", "#A99F87", "#EAD6A1", "#BDB49E"),
    "neutral": ("#E1E7E8", "#536F86", "#D1DCE1", "#A9B6BD"),
    "airport": ("#E9EDEA", "#BD3542", "#E0E5E5", "#B2B9B7"),
    "ferry": ("#F1F0E6", "#316B92", "#E5E8DB", "#DFE5DB"),
}
GLASS = "#192F3A"
GLASS_LIGHT = "#335663"
RUBBER = "#252A2D"
CHASSIS = "#424D53"
METAL = "#AFB9BD"
LIGHT = "#FFF0C0"
TAIL = "#D34A42"


def linear_color(hex_value):
    values = [int(hex_value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values) + (1.0,)


class Geometry:
    """Accumulate disconnected solids and panels without thousands of bpy ops."""

    def __init__(self):
        self.vertices = []
        self.faces = []
        self.colors = []

    def poly(self, points, color):
        first = len(self.vertices)
        self.vertices.extend(points)
        self.faces.append(tuple(range(first, first + len(points))))
        self.colors.append(color)

    def solid(self, points, faces, color):
        first = len(self.vertices)
        self.vertices.extend(points)
        for face in faces:
            self.faces.append(tuple(first + index for index in face))
            self.colors.append(color)

    def box(self, x, y, z, width, length, height, color):
        x0, x1 = x - width / 2, x + width / 2
        y0, y1 = y - length / 2, y + length / 2
        z0, z1 = z - height / 2, z + height / 2
        self.solid([(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                    (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
                   [(3, 2, 1, 0), (0, 1, 5, 4), (1, 2, 6, 5),
                    (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)], color)

    def loft(self, rings, color, roof_color=None):
        """Rings: (longitudinal position, width, bottom, roof). Octagonal section."""
        points = []
        for y, width, bottom, roof in rings:
            w = width / 2
            bevel = min(.17, width * .065)
            points.extend([(-w + bevel, y, bottom), (w - bevel, y, bottom),
                           (w, y, bottom + bevel), (w, y, roof - bevel),
                           (w - bevel, y, roof), (-w + bevel, y, roof),
                           (-w, y, roof - bevel), (-w, y, bottom + bevel)])
        first = len(self.vertices)
        self.vertices.extend(points)
        self.faces.append(tuple(first + i for i in reversed(range(8))))
        self.colors.append(color)
        for ring in range(len(rings) - 1):
            a, b = first + ring * 8, first + (ring + 1) * 8
            for i in range(8):
                self.faces.append((a + i, a + (i + 1) % 8, b + (i + 1) % 8, b + i))
                self.colors.append(roof_color if roof_color and i in (3, 4, 5) else color)
        self.faces.append(tuple(first + (len(rings) - 1) * 8 + i for i in range(8)))
        self.colors.append(color)

    def cylinder(self, x, y, z, radius, depth, color, axis="X", sides=12):
        points = []
        for d in (-depth / 2, depth / 2):
            for i in range(sides):
                a = 2 * math.pi * i / sides
                c, s = math.cos(a) * radius, math.sin(a) * radius
                if axis == "X":
                    points.append((x + d, y + c, z + s))
                elif axis == "Y":
                    points.append((x + c, y + d, z + s))
                else:
                    points.append((x + c, y + s, z + d))
        faces = [tuple(reversed(range(sides))), tuple(range(sides, sides * 2))]
        faces.extend((i, (i + 1) % sides, (i + 1) % sides + sides, i + sides) for i in range(sides))
        self.solid(points, faces, color)

    def bar(self, start, end, radius, color, sides=6):
        a, b = Vector(start), Vector(end)
        direction = (b - a).normalized()
        helper = Vector((0, 0, 1)) if abs(direction.z) < .9 else Vector((0, 1, 0))
        u = direction.cross(helper).normalized() * radius
        v = direction.cross(u).normalized() * radius
        points = [tuple(center + u * math.cos(i * math.tau / sides) + v * math.sin(i * math.tau / sides))
                  for center in (a, b) for i in range(sides)]
        faces = [tuple(reversed(range(sides))), tuple(range(sides, sides * 2))]
        faces.extend((i, (i + 1) % sides, (i + 1) % sides + sides, i + sides) for i in range(sides))
        self.solid(points, faces, color)

    def side(self, sign, width, y, z, length, height, color):
        x = sign * (width / 2 + .008)
        pts = [(x, y - length / 2, z - height / 2), (x, y + length / 2, z - height / 2),
               (x, y + length / 2, z + height / 2), (x, y - length / 2, z + height / 2)]
        self.poly(pts if sign == 1 else list(reversed(pts)), color)

    def mesh(self, name, collection, material, offset_y=0):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([(x, y + offset_y, z) for x, y, z in self.vertices], [], self.faces)
        mesh.update()
        # Original disconnected solids are closed; orient their normals outward.
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
        bm.free()
        attribute = mesh.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
        cache = {}
        for polygon, color in zip(mesh.polygons, self.colors):
            rgba = cache.setdefault(color, linear_color(color))
            for loop in polygon.loop_indices:
                attribute.data[loop].color = rgba
        mesh.color_attributes.active_color = attribute
        mesh.materials.append(material)
        mesh.calc_loop_triangles()
        obj = bpy.data.objects.new(name, mesh)
        collection.objects.link(obj)
        return obj


def material():
    mat = bpy.data.materials.get(MATERIAL_NAME) or bpy.data.materials.new(MATERIAL_NAME)
    mat.use_nodes = True
    mat.use_backface_culling = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    color = nodes.new("ShaderNodeVertexColor")
    color.layer_name = "Color"
    shader.inputs["Roughness"].default_value = .48
    shader.inputs["Metallic"].default_value = .08
    mat.node_tree.links.new(color.outputs["Color"], shader.inputs["Base Color"])
    mat.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return mat


def wheels(g, width, positions, radius=.39, bus=False):
    for y in positions:
        if not bus:
            g.box(0, y, radius + .03, width * .72, .9, .29, CHASSIS)
        for sign in (-1, 1):
            x = sign * (width / 2 - (.09 if bus else .27))
            g.cylinder(x, y, radius, radius, .22, RUBBER)
            g.cylinder(x + sign * .12, y, radius, radius * .51, .035, METAL)
            if bus:
                g.cylinder(x + sign * .145, y, radius, radius * .21, .038, CHASSIS)


def bogies(g, width, length, centers=None):
    radius = .34 if width < 2.5 else .39
    if centers is None:
        centers = [-length * .32, length * .32]
    for center in centers:
        g.box(0, center, .51, width * .70, 2.1, .29, CHASSIS)
        wheels(g, width, [center - .66, center + .66], radius)


def pantograph(g, y, roof, scale=1):
    # Folded rhombus and contact strip remain within the model's nominal height.
    g.box(0, y, roof + .04, .85 * scale, 1.35 * scale, .12, CHASSIS)
    z0, z1 = roof + .1, roof + .41 * scale
    for x in (-.31 * scale, .31 * scale):
        g.bar((x, y - .55 * scale, z0), (x, y + .12 * scale, z1), .025, METAL)
        g.bar((x, y + .55 * scale, z0), (x, y + .12 * scale, z1), .025, CHASSIS)
    g.box(0, y + .12 * scale, z1 + .015, 1.1 * scale, .10, .045, CHASSIS)


def bellows(g, y, width, bottom, top, gap):
    g.box(0, y, (bottom + top) / 2, width * .86, gap, top - bottom, RUBBER)
    for i in range(5):
        g.loft([(y - gap / 2 + gap * i / 5, width * .93, bottom, top),
                (y - gap / 2 + gap * (i + .36) / 5, width * .96, bottom, top)], CHASSIS)


def rail_livery(g, spec, length, width, roof, bottom, window_start, double):
    body, lower, door_color, roof_color = PALETTES[spec["livery"]]
    start, end = window_start
    available = end - start
    mid = (end + start) / 2
    liver = spec["livery"]
    for sign in (-1, 1):
        if liver == "sbahn":
            g.side(sign, width, mid, 1.10, available, .88, lower)
            g.side(sign, width + .004, mid, 1.56, available, .065, "#D7AD46")
        elif liver in ("odeg", "neb", "srs", "woltersdorf", "vip", "pkp", "cd", "neutral"):
            g.side(sign, width, mid, 1.0, available, .76, lower)
        elif liver == "ice":
            g.side(sign, width, mid, 1.35 if not double else 2.18, available, .23, lower)
        g.side(sign, width + .005, mid, bottom + .10, available, .15, CHASSIS)
        if double:
            rows = [(1.46, .73), (3.25, .88)]
        else:
            rows = [((1.86 if spec["mode"] == "tram" else 2.13), min(1.05, roof - 2.0))]
        # Window spacing stays plausible for short tram modules and full coaches.
        window_width = 1.0 if spec["mode"] in ("u-bahn", "tram") else 1.25
        count = max(1, int(available / (window_width + .32)))
        pitch = available / count
        for row_z, row_h in rows:
            for i in range(count):
                y = start + pitch * (i + .5)
                g.side(sign, width + .012, y, row_z, min(window_width, pitch * .78), row_h, GLASS)
                g.side(sign, width + .015, y, row_z + row_h * .35,
                       min(window_width, pitch * .78), .055, GLASS_LIGHT)
        doors = spec.get("doors", 2 if spec["mode"] == "regional" else 1)
        if spec["mode"] == "tram":
            doors = 1 if length < 7.8 else 2
        if spec["mode"] == "long-distance":
            door_positions = [start + .65, end - .65]
            door_width = .72
        elif double:
            door_positions = [start + .82, end - .82]
            door_width = 1.12
        else:
            door_positions = [start + available * (i + .5) / doors for i in range(doors)]
            door_width = min(1.25, available / max(1, doors) * .45)
        for y in door_positions:
            if spec.get("singleEnded") and sign == -1:
                continue
            height = 2.06 if not double else 1.94
            z = .83 + height / 2
            g.side(sign, width + .025, y, z, door_width, height, door_color)
            g.side(sign, width + .030, y, z + .32, door_width * .77, height * .47, GLASS)
            g.side(sign, width + .033, y, z, .025, height, CHASSIS)
            g.side(sign, width + .036, y + door_width * .38, z - .18, .045, .16, METAL)
        if liver == "neb":
            # Original geometric paint approximation, not a copied operator graphic.
            x = sign * (width / 2 + .022)
            pts = [(x, start, .68), (x, start + min(3.8, available * .3), .68),
                   (x, start + min(2.3, available * .22), 1.55), (x, start, 2.55)]
            g.poly(pts if sign == 1 else list(reversed(pts)), lower)
    return roof_color


NOSE = {
    "flat": (.16, .08, .97), "goggles": (.65, .25, .90),
    "modern": (.65, .34, .91), "classic": (.16, .06, .99),
    "hk": (.65, .45, .92), "ik": (.82, .50, .88), "j": (.88, .58, .87),
    "flexity": (.85, .50, .86), "urbanliner": (.90, .60, .83),
    "gt6": (.72, .34, .85), "gamma": (.50, .32, .94),
    "artic": (.9, .4, .85), "tatra": (.25, .15, .94),
    "combino": (.42, .2, .95), "variobahn": (.86, .4, .84),
    "tramlink": (.87, .50, .86), "dosto": (1.1, 1.1, .88),
    "talent": (1.35, 1.05, .80), "desiro": (1.65, 1.0, .81),
    "kiss": (1.1, .7, .89), "mireo": (1.7, 1.14, .77),
    "pesa": (2.1, 1.3, .70), "lint": (.8, .5, .91),
    "ice1": (3.15, 1.62, .72), "ice2": (3.4, 1.6, .70),
    "ice3": (5.35, 2.15, .53), "ice4": (3.8, 1.85, .64),
    "icet": (2.9, 1.60, .67), "comfortjet": (2.8, 1.6, .72),
    "coach": (.08, .05, .99),
}


def cab_detail(g, spec, length, width, roof, bottom):
    cab = spec["cab"]
    nose, drop, taper = NOSE[cab]
    y = -length / 2
    color = PALETTES[spec["livery"]][0]
    front_width = width * taper
    front_top = roof - drop
    if nose > 1.5:
        # Windshield sits on the sloped nose surface; light strips sit below.
        a, b = .53, .89
        z1, z2 = front_top + drop * a + .018, front_top + drop * b + .018
        w1 = width * (taper + (1 - taper) * a) * .35
        w2 = width * (taper + (1 - taper) * b) * .37
        g.poly([(-w1, y + nose * a, z1), (w1, y + nose * a, z1),
                (w2, y + nose * b, z2), (-w2, y + nose * b, z2)], GLASS)
    else:
        glass_bottom = max(1.48, front_top * .47)
        glass_top = front_top - .22
        split = cab in ("flat", "classic", "goggles", "tatra")
        if split:
            for sign in (-1, 1):
                x0, x1 = sign * .075, sign * front_width * .41
                g.poly([(min(x0, x1), y - .012, glass_bottom),
                        (max(x0, x1), y - .012, glass_bottom),
                        (max(x0, x1) * .94, y - .012, glass_top),
                        (min(x0, x1) * .94, y - .012, glass_top)], GLASS)
        else:
            low = 1.0 if cab in ("modern", "j", "urbanliner") else glass_bottom
            g.poly([(-front_width * .40, y - .012, low), (front_width * .40, y - .012, low),
                    (front_width * .38, y - .012, glass_top),
                    (-front_width * .38, y - .012, glass_top)], GLASS)
        g.box(0, y - .026, glass_top - .16, front_width * .52, .02, .17, "#111B20")
        # Route-neutral LED strokes: actual service labels belong to the viewer.
        for i in range(5):
            g.box((i - 2) * .105, y - .041, glass_top - .16, .074, .014, .054, "#E8B65A")
        if cab == "classic":
            g.box(0, y - .021, 1.75, .075, .018, 1.5, color)
    for sign in (-1, 1):
        g.box(sign * front_width * .32, y - .03, max(.86, bottom + .38), .31, .07, .13, LIGHT)
        g.box(sign * front_width * .32, y - .031, max(.70, bottom + .21), .15, .072, .065, TAIL)
    g.box(0, y - .11, .56, .29, .22, .20, CHASSIS)


def rail_car(spec, length, width, height, cab=False, double=False, power=False, panto=False, bogie_centers=None):
    g = Geometry()
    body, lower, _, roof_color = PALETTES[spec["livery"]]
    tram = spec["mode"] == "tram"
    bottom = .46 if tram else .65
    roof = height - (.48 if spec["mode"] in ("regional", "tram") or panto else .20)
    if spec["mode"] == "s-bahn":
        roof = height - .1
    nose, drop, taper = NOSE[spec["cab"]] if cab else (0, 0, 1)
    if cab and spec["livery"] == "neb":
        body = lower
    rings = [(-length / 2, width * taper, bottom, roof - drop)]
    if cab and nose:
        rings.append((-length / 2 + nose, width, bottom, roof))
    rings.append((length / 2, width, bottom, roof))
    g.loft(rings, body, roof_color)
    start, end = -length / 2 + max(nose + .18, .4), length / 2 - .4
    if not power:
        rail_livery(g, spec, length, width, roof, bottom, (start, end), double)
    else:
        for sign in (-1, 1):
            g.side(sign, width, (start + end) / 2, 1.34, end - start, .23, lower)
            for i in range(9):
                g.side(sign, width + .025, end - 2.3 + i * .17, 2.15, .09, .73, CHASSIS)
            g.side(sign, width + .02, start + .75, 2.25, 1.08, .70, GLASS)
    if cab:
        cab_detail(g, spec, length, width, roof, bottom)
    else:
        g.box(0, -length / 2 - .015, 1.9, width * .42, .04, 1.85, RUBBER)
    bogies(g, width, length, centers=bogie_centers)
    if length > 7:
        g.box(0, .8, .73, width * .72, min(length * .55, 8), .27, CHASSIS)
        g.box(0, 0, roof + .08, width * .58, min(3.1, length * .38), .15, roof_color)
    if panto:
        pantograph(g, length * .2, roof, .72 if tram else 1)
    if spec.get("battery"):
        for y in (-length * .17, length * .18):
            g.box(0, y, roof + .18, width * .68, length * .24, .34, roof_color)
    if spec.get("hydrogen"):
        for x in (-.43, .43):
            g.cylinder(x, 0, roof + .22, .20, length * .55, "#B3BDC1", axis="Y")
        g.box(0, 0, roof + .12, width * .75, length * .6, .12, CHASSIS)
    if spec.get("diesel"):
        g.box(0, .5, roof + .12, width * .7, length * .29, .23, CHASSIS)
        g.cylinder(.58, 1.3, roof + .25, .10, .18, CHASSIS, axis="Z", sides=8)
    return g


def locomotive(spec, length, width, height):
    g = Geometry()
    body, lower, _, roof_color = PALETTES[spec["livery"]]
    if spec["livery"] in ("pkp", "cd"):
        body = lower
    roof = height - .52
    g.loft([(-length / 2, width * .82, .75, roof - .8),
            (-length / 2 + 1.5, width, .75, roof),
            (length / 2 - 1.5, width, .75, roof),
            (length / 2, width * .82, .75, roof - .8)], body, roof_color)
    for sign in (-1, 1):
        for i in range(11):
            g.side(sign, width + .014, (i - 5) * .51, 2.4, .32, .92, CHASSIS)
        g.side(sign, width, 0, 1.15, length - 3, .26, lower)
        for y in (-length / 2 + 2.1, length / 2 - 2.1):
            g.side(sign, width + .02, y, 2.58, 1.0, .72, GLASS)
    for end in (-1, 1):
        y = end * (length / 2 + .013)
        g.poly([(-width * .32, y, 2.0), (width * .32, y, 2.0),
                (width * .31, y, roof - .94), (-width * .31, y, roof - .94)], GLASS)
        for sign in (-1, 1):
            g.box(sign * width * .29, y, 1.3, .36, .08, .16, LIGHT)
        g.box(0, y, .73, .4, .22, .20, CHASSIS)
    bogies(g, width, length)
    pantograph(g, -length * .26, roof)
    pantograph(g, length * .26, roof)
    return g


def segment_lengths(spec):
    count, length = spec["cars"], spec["length"]
    if spec["builder"] == "tram":
        gap = .26 if count > 1 else 0
        if count == 3:
            weights = [1, .62 if spec["cab"] == "tatra" else 1.05, 1]
        else:
            weights = [1.25 if i in (0, count - 1) else (.48 if i % 2 else 1.10)
                       for i in range(count)]
    elif spec["builder"] == "bus":
        gap = .58 if count > 1 else 0
        weights = [10.3, 7.1] if count == 2 else [1]
    else:
        gap = .28
        weights = [1] * count
        if spec.get("locomotive"):
            weights = [26.7] * (count - 1) + [19.0]
            if spec["cab"] == "coach":
                weights = [19.0] + [26.7] * (count - 1)
        elif spec.get("powerHeads"):
            weights = [20.5] + [26.4] * (count - 2) + [20.5]
        elif spec.get("singlePowerHead"):
            weights = [20.5] + [26.4] * (count - 1)
    usable = length - gap * (count - 1)
    return [usable * value / sum(weights) for value in weights], gap


def bus_body(spec, length, front, rear, width, height):
    g = Geometry()
    body, lower, door_color, roof_color = PALETTES[spec["livery"]]
    double = spec.get("doubleDeck", False)
    coach = spec.get("coach", False)
    roof = height - (.42 if spec.get("electric") else .12)
    bottom = .37
    taper = .94 if not spec.get("heritage") else .99
    g.loft([(-length / 2, width * taper if front else width, bottom, roof - (.09 if front else 0)),
            (-length / 2 + .33, width, bottom, roof), (length / 2, width, bottom, roof)], body, roof_color)
    g.box(0, 0, .39, width * .89, length - .25, .18, CHASSIS)
    for sign in (-1, 1):
        g.side(sign, width, 0, .79, length - .25, .47, lower)
        rows = [(1.60, 1.0), (3.0, 1.0)] if double else [(2.14 if coach else 2.00, 1.0)]
        for row_z, row_height in rows:
            windows = max(2, round(length / 1.32))
            pitch = (length - .65) / windows
            for i in range(windows):
                y = -length / 2 + .33 + pitch * (i + .5)
                g.side(sign, width + .012, y, row_z, pitch * .88, row_height, GLASS)
                g.side(sign, width + .015, y, row_z + row_height * .36, pitch * .83, .06, GLASS_LIGHT)
        if sign == 1:
            door_positions = [-length / 2 + .75]
            if not coach:
                door_positions.append(length * .15)
            if double and not spec.get("heritage"):
                door_positions.append(length / 2 - 1)
            for y in door_positions:
                g.side(sign, width + .025, y, 1.52, .99, 2.14, "#303A3B")
                g.side(sign, width + .03, y, 1.73, .84, 1.46, GLASS)
                g.side(sign, width + .033, y, 1.52, .04, 2.14, body)
                g.side(sign, width + .035, y, .51, 1.0, .09, METAL)
        # Wheel arch surrounds, covering the lower window/door bands.
        positions = [-length / 2 + 2.6, length / 2 - 2.2] if front else [length * .20]
        if double and not spec.get("heritage"):
            positions = [-length / 2 + 2.6, length / 2 - 3.5, length / 2 - 1.85]
        for y in positions:
            g.side(sign, width + .04, y, .62, 1.12, .62, body)
    axle_positions = [-length / 2 + 2.6, length / 2 - 2.2] if front else [length * .20]
    if double and not spec.get("heritage"):
        axle_positions = [-length / 2 + 2.6, length / 2 - 3.5, length / 2 - 1.85]
    wheels(g, width + .16, axle_positions, .49, bus=True)
    if front:
        y = -length / 2 - .012
        fw = width * taper
        g.box(0, y, 1.99 if not coach else 2.4, fw * .89, .035, 1.19, GLASS)
        if double:
            g.box(0, y, 3.14, fw * .89, .035, 1.03, GLASS)
        g.box(0, y - .025, 2.66 if not coach else 3.05, fw * .65, .026, .22, "#131D21")
        for i in range(7):
            g.box((i - 3) * .12, y - .044, 2.66 if not coach else 3.05, .082, .014, .064, "#E9B558")
        g.box(0, y, 1.01, fw * .8, .04, .29, body)
        for sign in (-1, 1):
            g.box(sign * fw * .33, y - .03, .93, .34, .075, .16, LIGHT)
            g.bar((sign * fw * .44, y + .2, 2.48), (sign * (width / 2 + .23), y + .30, 2.48), .035, CHASSIS)
            g.box(sign * (width / 2 + .24), y + .30, 2.31, .13, .25, .34, CHASSIS)
        for sign in (-1, 1):
            g.bar((sign * .2, y - .045, 1.42), (sign * .69, y - .045, 1.83), .018, RUBBER)
    if rear:
        y = length / 2 + .012
        g.box(0, y, 2.0, width * .75, .03, .82, GLASS)
        for sign in (-1, 1):
            g.box(sign * width * .37, y, .93, .17, .045, .31, TAIL)
        for i in range(6):
            g.box(0, y + .006, .65 + i * .07, width * .48, .04, .025, CHASSIS)
    if spec.get("electric"):
        for y in (-length * .20, length * .21):
            g.box(0, y, roof + .17, width * .74, min(2.8, length * .35), .32, roof_color)
        if spec["cars"] > 1 and front:
            pantograph(g, 0, roof + .04, .64)
    else:
        g.box(0, length * .1, roof + .06, width * .57, min(length * .25, 2.3), .12, roof_color)
    return g


def ferry(spec):
    g = Geometry()
    length, width = spec["length"], spec["width"]
    # Two narrow displacement hulls with a tapered bow, not a solid monohull.
    for sign in (-1, 1):
        x = sign * width * .35
        points = [(x - .49, -length / 2 + 1.3, .05), (x, -length / 2, .45),
                  (x + .49, -length / 2 + 1.3, .05), (x + .49, length / 2, .05),
                  (x - .49, length / 2, .05), (x - .51, -length / 2 + 1.3, .85),
                  (x, -length / 2, .85), (x + .51, -length / 2 + 1.3, .85),
                  (x + .51, length / 2, .85), (x - .51, length / 2, .85)]
        g.solid(points, [(0, 1, 2, 3, 4), (5, 9, 8, 7, 6), (0, 5, 6, 1),
                         (1, 6, 7, 2), (2, 7, 8, 3), (3, 8, 9, 4), (4, 9, 5, 0)], "#326582")
    g.box(0, .05, 1.0, width, length - 1.0, .30, "#E8E9DE")
    g.box(0, .65, 1.21, width * .87, length - 3.0, .15, "#CABFAA")
    # Passenger saloon and wheelhouse, with open bow/stern deck areas.
    g.loft([(-5.5, width * .69, 1.19, 2.86), (5.5, width * .69, 1.19, 2.86)], "#ECEDE4")
    for sign in (-1, 1):
        for i in range(7):
            g.side(sign, width * .69, (i - 3) * 1.45, 2.1, 1.28, 1.13, GLASS)
        for y in (-7.1, 7.0):
            for dx in (-1.7, 1.7):
                g.bar((dx, y, 1.12), (dx, y, 2.22), .035, METAL)
        g.bar((sign * width * .44, -7.0, 2.2), (sign * width * .44, 7.8, 2.2), .035, METAL)
        for y in (-6.5, -3.5, 0, 3.5, 6.7):
            g.bar((sign * width * .44, y, 1.18), (sign * width * .44, y, 2.22), .027, METAL)
        for y in (-7.4, 7.4):
            g.cylinder(sign * width * .48, y, 1.10, .19, .45, RUBBER, axis="Z")
    g.box(0, .2, 3.0, width * .94, length * .79, .16, "#E2E6DF")
    # Individually tiled original solar grid, vertex colors only.
    for x in range(4):
        for y in range(12):
            g.box((x - 1.5) * 1.15, (y - 5.5) * 1.16 + .2, 3.10,
                  1.06, 1.06, .035, "#1E3D57" if (x + y) % 2 else "#284B63")
    g.box(0, -5.9, 3.35, 2.15, 2.0, .77, "#E8EBE5")
    g.box(0, -6.92, 3.42, 1.95, .03, .54, GLASS)
    for sign in (-1, 1):
        g.side(sign, 2.15, -5.9, 3.42, 1.65, .54, GLASS)
    g.box(0, -5.9, 3.78, 2.35, 2.18, .10, "#E0E6DF")
    g.bar((0, -4.1, 3.05), (0, -4.1, 4.2), .043, METAL)
    g.bar((-.65, -4.1, 3.97), (.65, -4.1, 3.97), .035, METAL)
    return g


def create_asset(spec, scene, mat):
    collection = bpy.data.collections.new(spec["id"])
    scene.collection.children.link(collection)
    root = bpy.data.objects.new(spec["id"], None)
    root.empty_display_type = "PLAIN_AXES"
    root["modelId"] = spec["id"]
    root["family"] = spec["family"]
    root["units"] = "metres"
    collection.objects.link(root)
    lengths, gap = segment_lengths(spec)
    position = -spec["length"] / 2
    segments = []
    objects = [root]
    if spec["builder"] == "ferry":
        obj = ferry(spec).mesh("segment-01", collection, mat)
        obj.parent = root
        return root, [root, obj], [{"node": obj.name, "length": spec["length"], "offset": [0, 0, 0], "role": "hull"}]
    for index, length in enumerate(lengths):
        first, last = index == 0, index == len(lengths) - 1
        center = position + length / 2
        loc_index = (0 if spec.get("cab") == "coach" else len(lengths) - 1) if spec.get("locomotive") else -1
        # Buses do not have a cab field; no rail-only parameter should be read.
        if spec["builder"] == "bus":
            g = bus_body(spec, length, first, last, spec["width"], spec["height"])
            role = "front" if first else "trailer"
        else:
            cab = first or (last and not spec.get("singleEnded"))
            power = (spec.get("powerHeads") and (first or last)) or (spec.get("singlePowerHead") and first)
            double = spec.get("doubleDeck", False) or (spec.get("hybridDeck", False) and not first and not last)
            if spec.get("locomotive") and index == loc_index:
                g = locomotive(spec, length, spec["width"], spec["height"])
                role = "locomotive"
            else:
                is_electric_rail = spec["mode"] in ("tram", "regional", "long-distance") and not spec.get("diesel") and not spec.get("hydrogen") and spec["id"] != "rail-generic"
                panto = is_electric_rail and (index == (0 if spec["mode"] == "tram" else 1) or bool(power))
                if spec.get("locomotive"):
                    panto = False
                car_height = spec["height"] - (.58 if spec.get("hybridDeck") and not double else 0)
                bogie_centers = None
                if spec["mode"] == "tram":
                    bogie_centers = [] if length < 5 else [0]
                    if spec["cars"] == 1 or spec["cab"] == "artic" and not first and not last:
                        bogie_centers = [-length * .28, length * .28]
                elif spec["cab"] in ("talent", "mireo", "pesa", "lint"):
                    bogie_centers = [-length * .32, length * .47] if first else [-length * .32] if last else [length * .47]
                g = rail_car(spec, length, spec["width"], car_height, cab=cab and not spec.get("locomotive") or first and spec["cab"] != "coach", double=double, power=power, panto=panto, bogie_centers=bogie_centers)
                role = "power-head" if power else "driving-car" if cab else "car"
        flipped = last and not first and spec["builder"] != "bus"
        if not last and spec["builder"] in ("tram", "bus"):
            bellows(g, length / 2 + gap / 2, spec["width"], .58,
                    spec["height"] - (.5 if spec.get("electric") else .2), gap)
        # Mesh names are globally unique across the gallery; stored in metadata.
        name = f"{spec['id']}.segment-{index + 1:02d}"
        pivot = center
        mesh_shift = 0
        if spec["builder"] == "bus" and not first:
            pivot = position - gap / 2
            mesh_shift = center - pivot
        obj = g.mesh(name, collection, mat, offset_y=mesh_shift)
        obj.parent = root
        obj.location.y = pivot
        if flipped:
            obj.rotation_euler.z = math.pi
        obj["segmentIndex"] = index
        obj["role"] = role
        objects.append(obj)
        segments.append({"node": obj.name, "length": round(length, 4), "offset": [0, 0, round(-pivot, 4)], "role": role})
        position += length + gap
    return root, objects, segments


def expanded_services(text):
    import re
    result = []
    for token in text.split():
        match = re.fullmatch(r"([A-Z]*)(\d+)-([A-Z]*)(\d+)", token)
        if match:
            prefix, start, end_prefix, end = match.groups()
            if end_prefix and end_prefix != prefix:
                raise ValueError(f"Inconsistent route range: {token}")
            result.extend(f"{prefix}{i}" for i in range(int(start), int(end) + 1))
        else:
            result.append(token)
    return result


def service_catalog(fleet):
    result = []
    by_mode = {}
    for model in fleet["models"]:
        by_mode.setdefault(model["mode"], []).append(model["id"])
    regional = {
        "FEX": "db-regio-dosto", "RB10": "odeg-kiss", "RB14": "db-regio-dosto",
        "RB21": "db-talent2", "RB22": "db-talent2", "RB24": "db-regio-dosto",
        "RB25": "neb-mireo-b", "RB26": "neb-pesa-link", "RB27": "neb-mireo-h",
        "RB32": "db-regio-dosto", "RB55": "db-lint41", "RE1": "odeg-desiro-hc",
        "RE2": "db-regio-dosto", "RE3": "db-regio-dosto", "RE4": "db-regio-dosto",
        "RE5": "db-regio-dosto", "RE7": "db-talent2", "RE8": "odeg-kiss", "RE20": "db-regio-dosto",
    }
    tram = {"87": "tram-moderus-gamma", "88": "tram-srs-artic", "91": "tram-vip-combino",
            "92": "tram-vip-tramlink", "M4": "tram-urbanliner"}
    for line in ("60", "61"):
        tram[line] = "tram-gt6n"
    for line in ("21", "27", "62", "63", "67", "68"):
        tram[line] = "tram-gt6z"
    for line in ("12", "18", "50", "M2"):
        tram[line] = "tram-flexity-short"
    for mode, text in fleet["observedServices"].items():
        for line in expanded_services(text):
            confidence = "representative"
            note = "Family-level visual default; a route label does not identify the dispatched vehicle."
            source_urls = []
            if mode == "s-bahn":
                default = "sbahn-484" if line in ("S41", "S42", "S46", "S8") else "sbahn-483" if line == "S47" else "sbahn-481"
                alternatives = by_mode[mode]
                note = "Representative S-Bahn family. Class and two/four/six/eight-car formation require actual rolling-stock data; S15 is not class-identified here."
            elif mode == "u-bahn":
                small = int(line[1:]) <= 4
                alternatives = ["ubahn-a3", "ubahn-gi", "ubahn-hk", "ubahn-ik", "ubahn-jk"] if small else ["ubahn-f", "ubahn-h", "ubahn-j", "ubahn-ik"]
                default = "ubahn-ik" if small else "ubahn-h"
                note = "Small profile (U1-U4). Actual class unknown." if small else "Large profile (U5-U9); adapted IK units may also appear. Actual class unknown."
            elif mode == "tram":
                default = tram.get(line, "tram-flexity-long")
                alternatives = ["tram-srs-artic", "tram-srs-ktnf6"] if line == "88" else ["tram-vip-combino", "tram-vip-variobahn", "tram-vip-tramlink"] if line in ("91", "92") else ["tram-moderus-gamma"] if line == "87" else ["tram-flexity-short", "tram-flexity-long", "tram-urbanliner", "tram-gt6n", "tram-gt6z"]
                if line in ("87", "88", "M4"):
                    confidence = "family"
                note = "Operator/family verified; daily assignment and consist can vary." if confidence == "family" else "Representative fleet choice; exact line-by-line allocation not verified."
            elif mode == "regional":
                default = regional[line]
                alternatives = [default]
                if line in ("RB10", "RE8"):
                    alternatives.append("odeg-desiro-hc")
                if line == "RB26":
                    alternatives.append("neb-mireo-b")
                confidence = "representative" if line == "RB55" else "family"
                note = "Operator/VBB family evidence as of October 2026; modeled car count is representative, not a live formation."
                if line == "RB55":
                    note = "LINT 41 based on network contract. Current route source confirms diesel units but not the precise class."
                source_urls = [f"https://www.vbb.de/unterwegs-im-vbb/regionalbahnlinien/{line.lower()}/"]
            elif mode == "long-distance":
                if line.startswith("ICE"):
                    default = "ice-4"
                    alternatives = ["ice-1", "ice-2", "ice-3", "ice-4", "ice-t"]
                    confidence = "unknown"
                    note = "ICE family known, exact class for this departure unknown. ICE 4 is only a visual fallback; consult travel-day DB formation data."
                elif line == "IC2177":
                    default, alternatives, confidence = "ic2-dosto", ["ic2-dosto"], "family"
                    note = "2026 Rostock-Berlin-Dresden IC2 family, after the fleet change. Live formation still required for exact coach count."
                elif line == "RJ178":
                    default, alternatives, confidence = "cd-comfortjet", ["cd-comfortjet"], "family"
                    note = "CD Berliner ComfortJet family; RJ prefix does not imply red OeBB railjet."
                elif line == "EC246":
                    default, alternatives = "ec-coaches", ["ec-coaches"]
                    note = "Berlin-Warszawa conventional EuroCity representative. Exact EC 246 consist/livery not established."
                else:
                    default, alternatives, confidence = "rail-generic", ["rail-generic"], "unknown"
                    note = "Bare label 1236 cannot identify a train type, operator or consist. Neutral passenger-rail placeholder."
            elif mode == "ferry":
                default, alternatives, confidence = "ferry-faehrbaer", ["ferry-faehrbaer"], "family"
                note = "F23 solar-catamaran family; not the F24 rowing boat."
            else:
                alternatives = ["bus-bvg-solo", "bus-bvg-articulated", "bus-bvg-double-deck", "bus-bvg-electric", "bus-bvg-electric-articulated", "bus-regional"]
                unresolved = line in ("12", "27", "A", "T9", "E96", "334R", "X1", "M1", "M8")
                numeric = int(line) if line.isdigit() else 0
                if unresolved or numeric >= 400:
                    default, confidence = "bus-regional", "unknown"
                    note = "Agency/route identity absent. Neutral regional bus; do not infer BVG yellow or an exact manufacturer from the short label."
                else:
                    default = "bus-bvg-solo"
                    note = "Representative BVG yellow bus. Body type, manufacturer and traction need trip/vehicle or agency metadata; prefixes do not prove capacity."
                if line == "BER2":
                    default, alternatives = "bus-airport-coach", ["bus-airport-coach", "bus-regional"]
                    note = "BER2 operator Anger verified; coach shape/livery representative, actual dispatched model unknown."
                elif line == "218":
                    alternatives.append("bus-heritage-double-deck")
                    note += " Heritage double deckers cover some 218 workings; choose that alternative only with dispatch information."
                elif line == "300":
                    default = "bus-bvg-electric-articulated"
                    note = "Representative electric articulated bus based on documented initial deployment. Not a permanent assignment guarantee."
                elif line in ("S41", "S42", "U6"):
                    note = "Feed mode is BUS: this is a rail-replacement context. Render a bus; class/operator remain dispatch-dependent."
            result.append({"mode": mode, "line": line, "defaultModel": default,
                           "alternatives": [x for x in dict.fromkeys(alternatives) if x != default],
                           "confidence": confidence, "note": note, "sourceUrls": source_urls})
    return result


def bounds(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects if obj.type == "MESH" for corner in obj.bound_box]
    low = [min(p[i] for p in points) for i in range(3)]
    high = [max(p[i] for p in points) for i in range(3)]
    return {"width": round(high[0] - low[0], 4), "length": round(high[1] - low[1], 4),
            "height": round(high[2] - low[2], 4)}, low


def setup_gallery(scene, entries):
    # Common display length keeps a 346 m ICE from dwarfing a 12 m bus in the
    # authoring overview. Exports were already made at real scale at the origin.
    for index, (root, spec) in enumerate(entries):
        row, col = divmod(index, 7)
        root.scale = (min(1, 38 / spec["length"]),) * 3
        root.rotation_euler.z = -.63
        root.location = ((col - 3) * 30, -row * 42, 0)
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.world = bpy.data.worlds.new("Fleet studio")
    scene.world.color = (.17, .18, .20)
    scene.render.engine = "BLENDER_EEVEE"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1200
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    # Authoring labels never enter the per-vehicle exports.
    labels = bpy.data.collections.new("Gallery labels · not exported")
    scene.collection.children.link(labels)
    for index, (root, spec) in enumerate(entries):
        font = bpy.data.curves.new(spec["id"] + ".label", "FONT")
        font.body = spec["name"].replace(" · ", "\n")
        font.size = .86
        font.align_x = "CENTER"
        font.extrude = 0
        obj = bpy.data.objects.new(spec["id"] + ".label", font)
        labels.objects.link(obj)
        obj.location = (root.location.x, root.location.y - 21.3, .02)
    # User can orbit the fleet immediately when switching to this scene.
    if bpy.context.window:
        bpy.context.window.scene = scene
        for area in bpy.context.screen.areas:
            if area.type == "VIEW_3D":
                area.spaces.active.shading.type = "SOLID"
                area.spaces.active.shading.color_type = "VERTEX"
                area.spaces.active.region_3d.view_distance = 240
                area.spaces.active.region_3d.view_location = (0, -126, 0)
                area.spaces.active.region_3d.view_rotation = Vector((-155, 194, -320)).to_track_quat("-Z", "Y")
                area.spaces.active.region_3d.view_perspective = "ORTHO"


def build_pack(root_path):
    root_path = Path(root_path).resolve()
    fleet = json.loads((root_path / "assets/vehicles/fleet.json").read_text(encoding="utf-8"))
    out = root_path / "public/models/vehicles"
    out.mkdir(parents=True, exist_ok=True)
    # New scene instead of deleting or resetting the user's current scene.
    scene = bpy.data.scenes.new(SCENE_NAME)
    scene["berlinVehiclePack"] = True
    if bpy.context.window:
        bpy.context.window.scene = scene
    mat = material()
    records, entries = [], []
    for spec in fleet["models"]:
        asset_root, objects, segments = create_asset(spec, scene, mat)
        bpy.context.view_layer.update()
        dims, low = bounds(objects)
        center_x = low[0] + dims["width"] / 2
        center_y = low[1] + dims["length"] / 2
        # Feet/wheels/hulls sit on ground (glTF Y=0) with a centered footprint.
        # Preserve child pivots while translating geometry, not export root.
        for obj in objects:
            if obj.type == "MESH":
                obj.location.x -= center_x
                obj.location.y -= center_y
                for vertex in obj.data.vertices:
                    vertex.co.z -= low[2]
        for segment in segments:
            segment["offset"][0] = round(segment["offset"][0] - center_x, 4)
            segment["offset"][2] = round(segment["offset"][2] + center_y, 4)
        for obj in bpy.context.selected_objects:
            obj.select_set(False)
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = asset_root
        destination = out / f"{spec['id']}.glb"
        bpy.ops.export_scene.gltf(filepath=str(destination), export_format="GLB", use_selection=True,
                                  use_active_scene=True,
                                  export_yup=True, export_apply=False, export_materials="EXPORT",
                                  export_extras=True, export_cameras=False, export_lights=False,
                                  export_animations=False, export_texcoords=False, export_normals=True,
                                  export_tangents=False, export_attributes=False)
        meshes = [obj.data for obj in objects if obj.type == "MESH"]
        for mesh in meshes:
            mesh.calc_loop_triangles()
        records.append({key: spec[key] for key in ("id", "name", "mode", "operator", "family", "cars", "notes", "sourceIds")})
        records[-1].update({"modelUrl": f"/models/vehicles/{spec['id']}.glb", "dimensions": dims,
                           "nominalDimensions": {key: spec[key] for key in ("width", "length", "height")},
                           "triangles": sum(len(mesh.loop_triangles) for mesh in meshes),
                           "vertices": sum(len(mesh.vertices) for mesh in meshes), "drawCalls": len(meshes),
                           "bytes": destination.stat().st_size, "segments": segments})
        entries.append((asset_root, spec))
    catalog = {"schemaVersion": 1, "generatedAt": fleet["researchedAt"],
               "coordinates": {"unit": "meter", "up": "+Y", "forward": "+Z", "origin": "ground-center"},
               "license": "CC0-1.0", "models": records, "services": service_catalog(fleet),
               "sources": [{**source, "accessedAt": fleet["researchedAt"]} for source in fleet["sources"]]}
    (out / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    setup_gallery(scene, entries)
    bpy.context.view_layer.update()
    blend_path = root_path / "assets/vehicles/berlin-vehicle-fleet.blend"
    bpy.data.libraries.write(str(blend_path), {scene}, fake_user=True, compress=True)
    return {"scene": scene.name, "models": len(records), "services": len(catalog["services"]),
            "triangles": sum(m["triangles"] for m in records),
            "bytes": sum(m["bytes"] for m in records), "blendFile": str(blend_path),
            "blenderExecutable": bpy.app.binary_path}


if __name__ == "__main__":
    import argparse
    import sys
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    options = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    print(json.dumps(build_pack(options.root), indent=2))
