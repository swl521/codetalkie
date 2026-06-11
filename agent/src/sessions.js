import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// 项目+目录 → CLI sessionId 的持久注册表。持续对话 = 串行 resume 链,这里记链头。
// 注意:CLI 的会话档案与创建时的 cwd 绑定,换目录 resume 会失败,所以 key 必须含 cwd。
export class SessionStore {
  #map = {};

  constructor(filePath) {
    this.filePath = filePath;
    try {
      this.#map = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      this.#map = {};
    }
  }

  #key(project, cwd) {
    return `${project}@${cwd}`;
  }

  get(project, cwd) {
    return this.#map[this.#key(project, cwd)];
  }

  set(project, cwd, sessionId) {
    this.#map[this.#key(project, cwd)] = sessionId;
    this.#save();
  }

  clear(project, cwd) {
    delete this.#map[this.#key(project, cwd)];
    this.#save();
  }

  #save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.#map, null, 2));
  }
}
