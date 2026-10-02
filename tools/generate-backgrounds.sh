#!/bin/sh
# Genera los fondos de imagen incluidos con la aplicación (obra propia,
# sin licencias de terceros). Requiere ffmpeg y cwebp. Salida en
# src/assets/backgrounds/*.webp (se empaquetan con el frontend).
set -eu
cd "$(dirname "$0")/.."
out=src/assets/backgrounds
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"

# nombre | colores c0..c3 | ángulo (x0 y0 x1 y1) | desenfoque
render() {
  name=$1; colors=$2; coords=$3; blur=$4
  ffmpeg -hide_banner -loglevel error -y -f lavfi \
    -i "gradients=s=1920x1080:$colors:n=4:$coords:type=linear:seed=1" \
    -frames:v 1 -vf "gblur=sigma=$blur,vignette=angle=PI/4.2,noise=alls=4:allf=t" "$tmp/$name.png"
  cwebp -quiet -q 80 -m 6 "$tmp/$name.png" -o "$out/$name.webp"
  echo "$out/$name.webp"
}

render image-dusk    "c0=0x0f1b33:c1=0x2b3f6b:c2=0x6b4a6e:c3=0x1a1f3a" "x0=0:y0=0:x1=1920:y1=1080" 30
render image-sunrise "c0=0x1d2a44:c1=0x46597a:c2=0xc98a4b:c3=0x3a2c2a" "x0=300:y0=0:x1=1620:y1=1080" 25
render image-forest  "c0=0x0c1f18:c1=0x1f4a37:c2=0x3e6b4a:c3=0x0d1a14" "x0=0:y0=1080:x1=1920:y1=0" 35
render image-sea     "c0=0x06202e:c1=0x0e4a5e:c2=0x2c7d8a:c3=0x08222e" "x0=1620:y0=0:x1=300:y1=1080" 30
render image-wine    "c0=0x1e0b12:c1=0x4d1a2a:c2=0x7a3440:c3=0x220c14" "x0=1920:y0=0:x1=0:y1=1080" 35
render image-stone   "c0=0x1c1c1f:c1=0x3a3b40:c2=0x55565c:c3=0x202024" "x0=0:y0=0:x1=1920:y1=1080" 40
