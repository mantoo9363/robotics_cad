type ShapeWithDimensions = {
  type?: string;
  baseSize?: [number, number, number];
};

export const DEFAULT_BASE_SIZE: [number, number, number] = [1, 1, 1];

export function getPrimitiveBaseSize(type?: string): [number, number, number] {
  switch (type) {
    case "torus":
      return [1.1, 1.1, 0.3];
    case "cogwheel":
    case "cogwheel-6t":
    case "cogwheel-8t":
    case "cogwheel-12t":
    case "cogwheel-16t":
      return [1.0162029266357422, 0.23000000417232513, 1.0162029266357422];
    default:
      return DEFAULT_BASE_SIZE;
  }
}

export function getShapeBaseSize(shape?: ShapeWithDimensions | null): [number, number, number] {
  return shape?.baseSize ?? getPrimitiveBaseSize(shape?.type);
}
