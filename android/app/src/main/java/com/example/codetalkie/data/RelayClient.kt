package com.example.codetalkie.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class RelayException(message: String) : Exception(message)

/**
 * Cloudflare relay 的极简 HTTP 客户端。
 * 零外部依赖:HttpURLConnection + org.json(Android 内置)。
 * baseUrl/token 来自设置页(DataStore),不在代码里硬编码。
 */
class RelayClient(baseUrl: String, private val token: String) {

    private val base = baseUrl.trim().trimEnd('/')

    suspend fun fetchRegistry(): List<ProjectEntry> =
        RelayJson.parseRegistry(get("/registry"))

    suspend fun fetchHistory(project: String): List<HistoryLine> =
        RelayJson.parseHistory(get("/history?project=" + URLEncoder.encode(project, "UTF-8")))

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
