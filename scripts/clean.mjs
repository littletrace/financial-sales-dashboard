// dist 폴더 삭제.
// Windows + 비ASCII 경로(예: 한글 사용자명)에서 Node 24의 fs.rmSync({ recursive })와
// Vite의 emptyOutDir가 프로세스를 크래시시키는 문제가 있어 unlink/rmdir로 직접 지운다.
import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

function remove(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name)
    if (entry.isDirectory()) remove(target)
    else unlinkSync(target)
  }
  rmdirSync(dir)
}

if (existsSync('dist')) remove('dist')
