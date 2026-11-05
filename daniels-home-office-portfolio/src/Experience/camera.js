export const CAMERA_ROTATION = [
  -0.6138097686916666, -0.6852967312960734, -0.41947779883392433,
];

export const cameraPositions = {
  dark: {
    position: [
      -5.091815760151335 * 1.5,
      4.21834729421205 * 1.5,
      5.338096715730072 * 1.5,
    ],
  },
  light: {
    position: [3.2041090652046087, 16.216669507215555, 21.63810658489048],
  },
};

export const zoomFor = (isMobile) => ({
  default: isMobile ? 74 : 135,
  animation: isMobile ? 65 : 110,
});
