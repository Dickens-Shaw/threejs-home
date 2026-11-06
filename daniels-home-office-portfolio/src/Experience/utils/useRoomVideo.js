import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

// drei's useVideoTexture suspends until loadedmetadata. A cached file fires
// that event while src is assigned, before the listener exists, and the
// promise never resolves. The canvas then stays blank. The room should render
// even when the screen texture is still loading.
export function useRoomVideo(src) {
  const gl = useThree((state) => state.gl);

  const texture = useMemo(() => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.autoplay = true;
    video.preload = "auto";
    video.src = src;

    const map = new THREE.VideoTexture(video);
    map.colorSpace = gl.outputColorSpace;
    return map;
  }, [gl, src]);

  useEffect(() => {
    const video = texture.image;
    const play = () => {
      video.play?.().catch(() => {});
    };

    if (video.readyState >= 2) play();
    else video.addEventListener("loadeddata", play);

    return () => {
      video.removeEventListener("loadeddata", play);
      video.pause?.();
    };
  }, [texture]);

  return texture;
}
