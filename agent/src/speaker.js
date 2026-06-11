import { spawn } from 'node:child_process';

// MVP 扬声器:macOS `say` + 控制台。播完 resolve,保证串行。
export async function speak({ project, text }, { voice = 'Tingting', silent = false } = {}) {
  const sentence = project ? `${project}：${text}` : text;
  console.log(`🔊 ${sentence}`);
  if (silent) return;
  await new Promise((resolve) => {
    const p = spawn('say', ['-v', voice, sentence]);
    p.on('exit', resolve);
    p.on('error', resolve); // 没有 say(非 mac)就只打印
  });
}
