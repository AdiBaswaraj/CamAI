// Reverse map English noun phrases (incl. simple synonyms / plurals) to COCO-SSD class names.
export const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
  'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
  'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
  'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
  'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
  'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
  'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
  'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
  'toothbrush'
];

const ALIASES = {
  'phone': 'cell phone',
  'mobile': 'cell phone',
  'smartphone': 'cell phone',
  'tv': 'tv',
  'television': 'tv',
  'monitor': 'tv',
  'screen': 'tv',
  'fridge': 'refrigerator',
  'sofa': 'couch',
  'bottle': 'bottle',
  'can': 'bottle',
  'bag': 'handbag',
  'mug': 'cup',
  'glass': 'wine glass',
  'wine': 'wine glass',
  'plant': 'potted plant',
  'kitty': 'cat',
  'puppy': 'dog',
  'racket': 'tennis racket',
  'bat': 'baseball bat',
  'ball': 'sports ball',
  'sandwich': 'sandwich',
  'burger': 'sandwich',
  'doughnut': 'donut',
  'remote control': 'remote',
  'controller': 'remote'
};

function singularize(w) {
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ses') || w.endsWith('xes')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

// From a free-form phrase like "blue tie" pick the COCO classes mentioned.
export function inferClasses(phrase) {
  const words = phrase.toLowerCase().split(/\s+/).filter(Boolean).map(singularize);
  const matches = new Set();
  // Try multi-word class names first.
  for (const cls of COCO_CLASSES) {
    if (cls.includes(' ') && phrase.toLowerCase().includes(cls)) matches.add(cls);
  }
  for (const w of words) {
    if (COCO_CLASSES.includes(w)) matches.add(w);
    else if (ALIASES[w]) matches.add(ALIASES[w]);
  }
  return [...matches];
}
