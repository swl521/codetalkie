import { spawn } from 'node:child_process';

// MVP 扬声器:macOS `say` + 控制台。播完 resolve,保证串行。
// Windows 不做本机 TTS(产品的喇叭是手机/耳机),只打控制台。
export async function speak({ project, text }, { voice = 'Tingting', silent = false } = {}) {
  const sentence = project ? `${project}：${text}` : text;
  console.log(`🔊 ${sentence}`);
  if (silent || process.platform !== 'darwin') return;
  await new Promise((resolve) => {
    const p = spawn('say', ['-v', voice, sentence]);
    p.on('exit', resolve);
    p.on('error', resolve); // 没有 say(非 mac)就只打印
  });
}
