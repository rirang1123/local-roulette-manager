export interface ParsedAccumulation {
  item_name: string;
  amount: number;
  unit: string;
}

const UNITS = ['회', '개', '번', '초', '분', '세트', '점', '장'];
const UNIT_PATTERN = UNITS.join('|');

export function parseAccumulationContent(content: string): ParsedAccumulation {
  const normalized = content.trim();
  const trailingMatch = normalized.match(new RegExp(`^(.*?)(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})\\s*$`));
  if (trailingMatch) {
    return {
      item_name: trailingMatch[1].trim() || normalized,
      amount: Number(trailingMatch[2]),
      unit: trailingMatch[3],
    };
  }

  const embeddedMatch = normalized.match(new RegExp(`^(.*?)(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})(.*)$`));
  if (embeddedMatch) {
    const before = embeddedMatch[1].trim();
    const after = embeddedMatch[4].trim();
    return {
      item_name: `${before} ${after}`.trim() || normalized,
      amount: Number(embeddedMatch[2]),
      unit: embeddedMatch[3],
    };
  }

  const plusMatch = normalized.match(/^(.*?)(?:\+|＋)\s*(\d+(?:\.\d+)?)\s*$/);
  if (plusMatch) {
    return {
      item_name: plusMatch[1].trim() || normalized,
      amount: Number(plusMatch[2]),
      unit: '회',
    };
  }

  return {
    item_name: normalized,
    amount: 1,
    unit: '회',
  };
}
