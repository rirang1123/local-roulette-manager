import type { RawRoulettePayload } from './event-normalizer';

export function parseWeflabRoulettePayloads(text: unknown): RawRoulettePayload[] {
  function clean(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function linesFromText(value: unknown): string[] {
    return String(value || '')
      .split(/\n+/)
      .map(clean)
      .filter(Boolean);
  }

  function hasRouletteSignal(value: string): boolean {
    return /룰렛|당첨|미션|권|스쿼트|팔굽혀펴기|초|분|회|개|세트|벌칙|스택|인증|셀카|방셀|초대권|플로팅|배너|헤어/.test(value);
  }

  function extractValue(value: string): number {
    const matches = [...value.matchAll(/([0-9][0-9,]*)\s*(?:개|원|풍|별풍선|P|p|포인트)/g)];
    if (!matches.length) return 0;

    const nonContentMatch = matches.find((match) => {
      const index = match.index || 0;
      const before = value.slice(Math.max(0, index - 8), index);
      const after = value.slice(index, index + match[0].length + 8);
      return !/스쿼트|팔굽혀펴기|미션|벌칙|스택/.test(before + after);
    });

    const selected = nonContentMatch || matches[0];
    return Number(selected[1].replace(/,/g, ''));
  }

  function stripRouletteLabel(line: string): string {
    return clean(line)
      .replace(/^(룰렛\s*결과|룰렛|당첨|결과)\s*[:：\-]?\s*/u, '')
      .trim();
  }

  function isBlockedContent(line: string): boolean {
    if (!line || line.length > 80) return true;
    if (/^(내용|값|닉네임|날짜\/시간)$/.test(line)) return true;
    if (/전체|목록|확률|공유|오리지널.*오리지널/.test(line)) return true;
    const repeatedItemSignals = line.match(/초대권|플로팅|배너|헤어|오리지널|디지털/g) || [];
    return repeatedItemSignals.length > 3;
  }

  function hasItemSignal(line: string): boolean {
    return /미션|권|스쿼트|팔굽혀펴기|초|분|회|개|세트|벌칙|스택|인증|셀카|방셀|초대권|플로팅|배너|헤어|당첨/.test(line);
  }

  function extractRouletteContents(lines: string[], normalized: string): string[] {
    const contents: string[] = [];
    let afterResultLabel = false;

    for (const line of lines) {
      const labelOnly = /^(룰렛\s*결과|룰렛|당첨|결과)\s*[:：\-]?\s*$/u.test(line);
      if (labelOnly) {
        afterResultLabel = true;
        continue;
      }

      const stripped = stripRouletteLabel(line);
      const hadLabel = stripped !== line;
      if (isBlockedContent(stripped)) continue;
      if (hadLabel || afterResultLabel || hasItemSignal(stripped)) {
        contents.push(stripped);
      }
    }

    if (contents.length) return contents;

    const labeled = normalized.match(/(?:룰렛\s*결과|룰렛|당첨|결과)\s*[:：\-]?\s*([^|/\n]{1,80})/u);
    if (labeled) {
      const content = clean(labeled[1]);
      if (!isBlockedContent(content)) return [content];
    }

    return [];
  }

  function extractNickname(lines: string[], rouletteContent: string): string {
    const labeled = lines.join(' ').match(/(?:닉네임|후원자|보낸이|from)\s*[:：\-]?\s*([^|/\s]{1,30})/i);
    if (labeled) return clean(labeled[1]);

    const candidate = lines.find((line) =>
      line !== rouletteContent &&
      !/룰렛|당첨|결과|후원|개|원|풍|별풍선|초|분|회|미션|권|전체|목록|확률|공유|오리지널|디지털/.test(line) &&
      line.length <= 30 &&
      !/^\d[\d,]*$/.test(line)
    );
    return candidate || '알 수 없음';
  }

  const normalized = clean(text);
  if (!normalized || normalized.length < 2 || !hasRouletteSignal(normalized)) return [];

  const lines = linesFromText(text);
  if (!lines.length) return [];

  const value = extractValue(normalized);
  const rouletteContents = extractRouletteContents(lines, normalized);
  if (!rouletteContents.length) return [];
  const nickname = extractNickname(lines, rouletteContents[0]);

  return rouletteContents.map((rouletteContent, index) => ({
    nickname,
    value,
    roulette_content: rouletteContent,
    raw_payload: {
      text: normalized,
      batch_index: index,
      batch_total: rouletteContents.length,
    },
  }));
}
