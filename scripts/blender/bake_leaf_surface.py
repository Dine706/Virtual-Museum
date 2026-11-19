"""Shared wax and vein relief for the dimensional understory blades."""
from pathlib import Path
import numpy as np
from scipy.ndimage import gaussian_filter
from PIL import Image

root=Path(__file__).resolve().parents[2]/'public/walk/tex'
n=1024
y,x=np.mgrid[0:n,0:n]/n
x=2*x-1
rng=np.random.default_rng(748)
fine=rng.normal(size=x.shape)
mottle=gaussian_filter(fine,7); mottle/=np.std(mottle)
vein_phase=16*y+3.1*abs(x)**.78+.09*np.sin(y*39+x*9)
ribs=np.exp(-((np.sin(np.pi*vein_phase))/.15)**2)*(1-.53*abs(x))
mid=np.exp(-(x/.021)**2)
fine_veins=np.cos(vein_phase*np.pi*12)**10
texture=.86+.08*ribs+.22*mid+.022*mottle+.013*fine+.034*fine_veins-.043*abs(x)
def save(rgb,filename):
    Image.fromarray(np.uint8(255*np.clip(rgb,0,1))).save(root/filename,quality=94)
save(np.stack([texture*(1+.045*mid),texture,texture*(1-.07*mid)],axis=-1),'forest-leaf.webp')
dy,dx=np.gradient(ribs*.75+mid*1.6+fine_veins*.09+mottle*.035)
normal=np.stack([-dx*2.9,dy*2.9,np.ones_like(x)],axis=-1)
save(.5+.5*normal/np.linalg.norm(normal,axis=-1,keepdims=True),'forest-leaf-normal.webp')
