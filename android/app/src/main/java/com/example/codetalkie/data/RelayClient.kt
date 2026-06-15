package com.example.codetalkie.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class RelayException(message: String) : Exception(message)

/** 配对认领失败原因,供 UI 选文案。 */
enum class PairError { INVALID, RATE_LIMITED, NETWORK }

class PairException(val kind: PairError) : Exception(kind.name)

/**
 * Cloudflare relay 的极简 HTTP 客户端。
 * 零外部依赖:HttpURLConnection + org.json(Android 内置)。
 * baseUrl/token 来自设置页(DataStore),不在代码里硬编码。
 */
class RelayClient(baseUrl: String, private val token: String) {

    private val base = baseUrl.trim().trimEnd('/')

    companion object {
        /**
         * 配对认领:免鉴权 POST /pair/claim,凭 6 位码换账户密钥。
         * 成功返回 accountKey;失败抛 PairException(INVALID=404、RATE_LIMITED=429、NETWORK=其它/超时)。
         */
        suspend fun claim(baseUrl: String, code: String): String = withContext(Dispatchers.IO) {
            val base = baseUrl.trim().trimEnd('/')
            val conn = URL("$base/pair/claim").openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.connectTimeout = 8_000
                conn.readTimeout = 8_000
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.outputStream.use {
                    it.write(JSONObject().put("code", code).toString().toByteArray(Charsets.UTF_8))
                }
                when (val rc = conn.responseCode) {
                    in 200..299 -> {
                        val body = conn.inputStream.bufferedReader().use { it.readText() }
                        val key = JSONObject(body).optString("accountKey")
                        if (key.isBlank()) throw PairException(PairError.NETWORK)
                        key
                    }
                    404 -> throw PairException(PairError.INVALID)
                    429 -> throw PairException(PairError.RATE_LIMITED)
                    else -> throw PairException(if (rc == 400) PairError.INVALID else PairError.NETWORK)
                }
            } catch (e: PairException) {
                throw e
            } catch (e: Exception) {
                throw PairException(PairError.NETWORK)
            } finally {
                conn.disconnect()
            }
        }
    }

    suspend fun fetchRegistry(): List<ProjectEntry> =
        RelayJson.parseRegistry(get("/registry"))

    // relay 按"插入顺序"返回(seed 段在前、live 行在后),不是时间序。按 ts 排,
    // 否则最新回填内容被压在旧 live 行上面,聊天底部看着像"卡住没更新"。
    suspend fun fetchHistory(project: String): List<HistoryLine> =
        RelayJson.parseHistory(get("/history?project=" + URLEncoder.encode(project, "UTF-8")))
            .sortedBy { it.ts }

    suspend fun fetchProjects(): List<ProjectLast> =
        RelayJson.parseProjects(get("/projects"))

    suspend fun fetchStatus(): List<MachineStatus> =
        RelayJson.parseStatus(get("/status"))

    /** POST /command,text 须已带项目名前缀,relay 返回 202。 */
    suspend fun sendCommand(text: String) {
        post("/command", JSONObject().put("text", text).toString())
    }

    suspend fun respondApproval(id: String, approve: Boolean) {
        post("/approval/respond", JSONObject().put("id", id).put("approve", approve).toString())
    }

    /** 强制同步:戳电脑重扫重推该项目。POST /resync {"project":"项目名"}。 */
    suspend fun resync(project: String) {
        post("/resync", JSONObject().put("project", project).toString())
    }

    /** 开通 Pro:POST /pro/checkout → 返回 Stripe 托管结账页 URL(用浏览器打开)。 */
    suspend fun proCheckout(): String? =
        runCatching { JSONObject(post("/pro/checkout", "{}")).optString("url").ifBlank { null } }.getOrNull()

    /** 查 Pro 状态:GET /pro/status → 是否已订阅。 */
    suspend fun proActive(): Boolean =
        runCatching { JSONObject(get("/pro/status")).optBoolean("pro", false) }.getOrDefault(false)

    private suspend fun get(path: String): String = request("GET", path, null)

    private suspend fun post(path: String, body: String): String = request("POST", path, body)

    private suspend fun request(method: String, path: String, body: String?): String =
        withContext(Dispatchers.IO) {
            val conn = URL(base + path).openConnection() as HttpURLConnection
            try {
                conn.requestMethod = method
                conn.connectTimeout = 8_000
                conn.readTimeout = 8_000
                conn.setRequestProperty("Authorization", "Bearer $token")
                if (body != null) {
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.doOutput = true
                    conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                }
                val code = conn.responseCode
                if (code !in 200..299) throw RelayException("HTTP $code $method $path")
                conn.inputStream.bufferedReader().use { it.readText() }
            } finally {
                conn.disconnect()
            }
        }
}
