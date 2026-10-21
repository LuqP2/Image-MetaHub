"""Numerical tests of the real helper. Creates only synthetic EXRs in --work.

CI dependencies are pinned in exr-runtime.yml. This is not visual/UI testing.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

import numpy as np
import OpenEXR
import PyOpenColorIO as ocio
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--helper', required=True)
parser.add_argument('--work', required=True)
args = parser.parse_args()
work = Path(args.work).resolve()
work.mkdir(parents=True, exist_ok=True)
helper = subprocess.Popen([str(Path(args.helper).resolve())], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
sequence = 0
measurements = []

def call(op, **kwargs):
    global sequence
    sequence += 1
    helper.stdin.write(json.dumps(dict(id=str(sequence), op=op, **kwargs)) + '\n')
    helper.stdin.flush()
    response = json.loads(helper.stdout.readline())
    assert response['id'] == str(sequence), response
    assert response['success'], response
    return response['value']

def write(name, channels, **header):
    target = work / name
    OpenEXR.File(dict(compression=OpenEXR.ZIP_COMPRESSION, **header), channels).write(str(target))
    return target

def render(file, **kwargs):
    output = work / f'preview-{sequence}.png'
    start = time.perf_counter()
    info = call('render', filePath=str(file), output=str(output), **kwargs)
    measurements.append(dict(file=file.name, seconds=round(time.perf_counter()-start, 4), width=info['width'], height=info['height']))
    return info, np.array(Image.open(output).convert('RGBA'))

config_id = 'ocio://cg-config-v2.2.0_aces-v1.3_ocio-v2.4'
cfg = ocio.Config.CreateFromBuiltinConfig(config_id[7:])
display = cfg.getDefaultDisplay()
view = cfg.getDefaultView(display)
profile = dict(config=config_id, input='ACEScg', display=display, view=view)

try:
    assert call('self-test')['ok']
    assert call('config', config='ocio://cg-config-v4.0.0_aces-v2.0_ocio-v2.5')['spaces']
    rgb = np.array([.18, .5, 2.], dtype=np.float32)
    alpha = np.full((8, 8), .5, dtype=np.float32)
    file = write('rgba-float.exr', {name: np.full((8,8), float(rgb[i])*.5, dtype=np.float32) for i,name in enumerate('RGB')} | {'A':alpha})
    original = hashlib.sha256(file.read_bytes()).hexdigest()
    for exposure in [0., 1., -2.]:
        info, pixels = render(file, profile=profile, mode='color', exposure=exposure)
        linear = cfg.getColorSpace(ocio.ROLE_SCENE_LINEAR).getName()
        source = cfg.getProcessor('ACEScg', linear).getDefaultCPUProcessor().applyRGB(rgb.tolist())
        result = cfg.getProcessor(linear, display, view, ocio.TRANSFORM_DIR_FORWARD).getDefaultCPUProcessor().applyRGB([v*2**exposure for v in source])
        expected = np.rint(np.clip(np.array(result),0,1)*255).astype(np.uint8)
        assert np.max(np.abs(pixels[0,0,:3].astype(int)-expected.astype(int))) <= 1, (pixels[0,0], expected)
        assert pixels[0,0,3] in (127,128)
        assert info['mode'] == 'color'
    assert hashlib.sha256(file.read_bytes()).hexdigest() == original
    _, crop = render(file, profile=profile, region=dict(x=2,y=3,width=3,height=2))
    assert crop.shape == (2,3,4)

    ids = np.array([[0, 1, 16777217, 4294967294]],dtype=np.uint32)
    data = write('data-channels.exr', {
        'normal.X': np.full((1,4),-1.,dtype=np.float32),
        'normal.Y': np.zeros((1,4),dtype=np.float32),
        'normal.Z': np.ones((1,4),dtype=np.float32),
        'depth.Z': np.array([[0.,1.,2.,np.inf]],dtype=np.float32),
        'ObjectID': ids,
    })
    info, pixels = render(data, channels=['normal.X','normal.Y','normal.Z'],mode='normal')
    assert tuple(pixels[0,0]) == (0,128,255,255)
    assert info['input'] == ''
    _, pixels = render(data, channels=['depth.Z'],mode='scalar',range=[0.,2.])
    assert tuple(pixels[0,3]) == (255,0,255,255)
    _, pixels = render(data, channels=['ObjectID'],mode='id')
    def id_color(value):
        if not value: return (0,0,0)
        value ^= value >> 16
        value = (value * 0x7feb352d) & 0xffffffff
        value ^= value >> 15
        value = (value * 0x846ca68b) & 0xffffffff
        value ^= value >> 16
        return (value & 255, (value >> 8) & 255, (value >> 16) & 255)
    for i, value in enumerate(ids[0]): assert tuple(pixels[0,i,:3]) == id_color(int(value)), (value,pixels[0,i])

    multipart = work / 'multipart.exr'
    parts = [OpenEXR.Part({'name':name}, {c:np.full((4,4),.2,dtype=np.float16) for c in 'RGB'}) for name in ['specular','beauty']]
    OpenEXR.File(parts).write(str(multipart))
    info = call('inspect',filePath=str(multipart))
    assert len(info['parts']) == 2
    result, _ = render(multipart, profile=profile)
    assert result['part'] == 1, result
    shifted = write('shifted-window.exr', {c:np.full((4,4),.25,dtype=np.float16) for c in 'RGBA'},
        dataWindow=(np.array([2,2],dtype=np.int32),np.array([5,5],dtype=np.int32)),
        displayWindow=(np.array([0,0],dtype=np.int32),np.array([7,7],dtype=np.int32)),pixelAspectRatio=2.)
    info, pixels = render(shifted,profile=profile)
    assert pixels.shape == (8,16,4)
    assert pixels[0,0,3] == 0
    for compression in [OpenEXR.NO_COMPRESSION, OpenEXR.RLE_COMPRESSION, OpenEXR.PIZ_COMPRESSION, OpenEXR.DWAA_COMPRESSION, OpenEXR.DWAB_COMPRESSION]:
        compressed = work / f'compression-{compression}.exr'
        OpenEXR.File({'compression':compression},{c:np.full((8,8),.2,dtype=np.float16) for c in 'RGB'}).write(str(compressed))
        assert render(compressed,profile=profile)[0]['width'] == 8
    tiles = OpenEXR.TileDescription()
    tiled = write('tiled.exr',{c:np.full((64,64),.2,dtype=np.float16) for c in 'RGB'},type=OpenEXR.tiledimage,tiles=tiles)
    assert render(tiled,profile=profile)[0]['width'] == 64
    for size in [4096,8192]:
        gray = np.full((size,size),.18,dtype=np.float16)
        large = write(f'synthetic-{size}.exr',{c:gray for c in 'RGB'})
        result, _ = render(large,profile=profile,maxEdge=2048)
        assert result['width'] == 2048
        assert render(large,profile=profile,region=dict(x=200,y=300,width=256,height=256))[0]['width'] == 256
        del gray
    print(json.dumps({'ok':True,'measurements':measurements},indent=2))
finally:
    helper.stdin.close()
    try: helper.wait(timeout=5)
    except subprocess.TimeoutExpired: helper.kill()
    stderr = helper.stderr.read()
    if stderr: print(stderr)
