"""Bake the massif's sky visibility and its terrain horizon towards the morning sun."""
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

root = Path(__file__).resolve().parents[1] / 'public'
tex = np.asarray(Image.open(root / 'data/terrarium.png')).astype('float32')
height = tex[:, :, 0] * 256 + tex[:, :, 1] + tex[:, :, 2] / 256 - 32768
spacing = 30900 / len(height)
padded = np.pad(height, 130, mode='edge')
horizons = []
for az in (102, 147, 192, 237, 282, 327, 12, 57):
    angle = np.deg2rad(az)
    horizon = np.zeros_like(height)
    for distance in (1, 2, 4, 7, 12, 18, 28, 45, 70, 100, 128):
        x = 130 + round(distance * np.sin(angle))
        z = 130 - round(distance * np.cos(angle))
        elevated = padded[z:z+len(height), x:x+len(height)]
        horizon = np.maximum(horizon, (elevated-height) / (spacing*distance))
    horizons.append(np.arctan(horizon))
sky = 1 - np.mean(np.sin(horizons), axis=0)
relief = np.clip(.5 + (height - gaussian_filter(height, 3))/45, 0, 1)
pixels = np.stack([horizons[0]/(np.pi/2), sky, relief], axis=2)
Image.fromarray(np.uint8(np.clip(pixels,0,1)*255)).save(root/'landscape/ridge-relief.png')
