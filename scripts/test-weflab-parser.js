const assert = require('node:assert/strict');
const vm = require('node:vm');
const { parseWeflabRoulettePayloads } = require('../dist/main/monitor/weflab-parser.js');
const { DuplicateGuard } = require('../dist/main/monitor/duplicate-guard.js');

function names(payloads) {
  return payloads.map((payload) => payload.roulette_content);
}

const nickname = '테스트유저';

{
  const payloads = parseWeflabRoulettePayloads([
    `닉네임: ${nickname}`,
    '후원금: 1,000원',
    '룰렛 결과: 오리지널 헤어 움짤',
  ].join('\n'));

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].nickname, nickname);
  assert.equal(payloads[0].value, 1000);
  assert.equal(payloads[0].roulette_content, '오리지널 헤어 움짤');
}

{
  const payloads = parseWeflabRoulettePayloads([
    nickname,
    '1,000원',
    '오리지널 헤어 움짤',
  ].join('\n'));

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].nickname, nickname);
  assert.equal(payloads[0].value, 1000);
  assert.equal(payloads[0].roulette_content, '오리지널 헤어 움짤');
}

{
  const expected = [
    '오리지널 헤어 움짤',
    '고기파티 초대권',
    '오리지널 헤어 움짤',
    '디지털트래쉬 8평',
    '플로팅 배너',
    '오리지널 헤어 단컷',
    '고기파티 초대권',
    '방셀권',
    '애교송',
    '스쿼트 10회',
  ];
  const payloads = parseWeflabRoulettePayloads([
    `닉네임: ${nickname}`,
    '후원금: 10,000원',
    '룰렛 결과',
    ...expected,
  ].join('\n'));

  assert.equal(payloads.length, 10);
  assert.deepEqual([...names(payloads)], expected);
  assert.deepEqual(payloads.map((payload) => payload.raw_payload.batch_index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(payloads[0].raw_payload.batch_total, 10);
}

{
  const payloads = parseWeflabRoulettePayloads([
    '전체 로그',
    '날짜/시간',
    '닉네임',
    '값',
    '룰렛 내용',
    '알 수 없음',
    '0',
    '서수스 고기파티 초대권 디지털트래쉬 8평 애교송 오리지널 플로팅 배너 방편 오리지널 헤어 움짤 오리지널 헤어 단컷 링크',
  ].join('\n'));

  assert.equal(payloads.length, 0);
}

{
  const guard = new DuplicateGuard();
  const received_at = '2026-05-29T22:00:00+09:00';
  const base = {
    id: 'evt_test',
    nickname,
    value: 10000,
    roulette_content: '오리지널 헤어 움짤',
    category: 'action',
    status: 'pending',
    received_at,
  };

  assert.equal(guard.isDuplicate({ ...base, raw_payload: { batch_index: 0 } }), false);
  assert.equal(guard.isDuplicate({ ...base, raw_payload: { batch_index: 1 } }), false);
  assert.equal(guard.isDuplicate({ ...base, raw_payload: { batch_index: 0 } }), true);
}

{
  const expected = Array.from({ length: 10 }, (_, index) => `주입테스트${index + 1} 초대권`);
  const text = [
    `닉네임: ${nickname}`,
    '후원금: 10,000원',
    '룰렛 결과',
    ...expected,
  ].join('\n');
  const injectedParser = vm.runInNewContext(`(${parseWeflabRoulettePayloads.toString()})`);
  const payloads = injectedParser(text);

  assert.equal(payloads.length, 10);
  assert.deepEqual(Array.from(names(payloads)), expected);
}

console.log('weflab parser tests passed');
