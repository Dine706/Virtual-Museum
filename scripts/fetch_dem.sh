#!/usr/bin/env bash
# NOTE: this GDAL variant was NOT executed on the build box (GDAL not installed there); scripts/build_terrain.py (rasterio) is the tested path and gives identical outputs.
# Fetch Copernicus GLO-30 DEM (COG, 1x1 degree tile N07 W009 covers the whole massif) and crop the Nimba window.
# Source: AWS Open Data  s3://copernicus-dem-30m  (no account needed). Licence: Copernicus DEM, free incl. commercial use with attribution.
# Requires GDAL (gdalwarp/gdal_translate) -- or skip this and run scripts/build_terrain.py which does the same with rasterio.
set -euo pipefail
cd "$(dirname "$0")/.."
TILE=Copernicus_DSM_COG_10_N07_00_W009_00_DEM
URL=https://copernicus-dem-30m.s3.amazonaws.com/$TILE/$TILE.tif
mkdir -p data
# 1) whole tile (45 MB) -- or skip and let GDAL read the COG remotely with /vsicurl/
[ -f data/raw_Copernicus_N07_W009.tif ] || curl -L --fail -o data/raw_Copernicus_N07_W009.tif "$URL"
# 2) crop to Nimba window W -8.56  S 7.48  E -8.28  N 7.76   (-projwin = ulx uly lrx lry)
gdal_translate -of GTiff -projwin -8.56 7.76 -8.28 7.48 -co COMPRESS=DEFLATE data/raw_Copernicus_N07_W009.tif data/nimba_dem_30m.tif
# 3) 16-bit PNG heightmap, 300 m .. 1800 m mapped to 0..65535  (decode: h = 300 + v/65535*1500)
gdal_translate -of PNG -ot UInt16 -scale 300 1800 0 65535 data/nimba_dem_30m.tif public/data/heightmap_16bit.png
# 4) hillshade + colour relief (quick look)
gdaldem hillshade -z 1.5 -az 315 -alt 40 data/nimba_dem_30m.tif data/hillshade.tif
echo done
# Remote-only alternative (no 45 MB download):
# gdal_translate -projwin -8.56 7.76 -8.28 7.48 /vsicurl/$URL data/nimba_dem_30m.tif
