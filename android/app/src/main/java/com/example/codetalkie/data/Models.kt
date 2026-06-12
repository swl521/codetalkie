package com.example.codetalkie.data

import org.json.JSONArray
import org.json.JSONObject

/** GET /registry 的一行:一个 CLI 项目会话。 */
data class ProjectEntry(
    val name: String,
    val cwd: String,
    val agent: String,
    val machine: String,
    val lastActive: Long,
    val needsRename: Boolean,
)

/** GET /history 的一行字幕。role: user / assistant / event */
data class HistoryLine(
    val role: String,
    val text: String,
    val ts: Long,
    val src: String?,
)

/** GET /projects 的一行:项目最后一句(列表副标题用)。 */
data class ProjectLast(
    val name: String,
    val last: String,
    val ts: Long,
)

/** GET /status 里 machines 的一台机器。 */
data class MachineStatus(
    val name: String,
    val lanIPs: List<String>,
    val running: Int,
    val queued: Int,
)

/** relay JSON 解析,宽容缺字段(全部 opt*)。 */
object RelayJson {

    fun parseRegistry(body: String): List<ProjectEntry> {
        val arr = JSONArray(body)
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            ProjectEntry(
                name = o.optString("name"),
                cwd = o.optString("cwd"),
                agent = o.optString("agent"),
                machine = o.optString("machine"),
                lastActive = o.optLong("lastActive"),
                needsRename = o.optBoolean("needsRename"),
            )
        }
    }

    fun parseHistory(body: String): List<HistoryLine> {
        val arr = JSONArray(body)
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            HistoryLine(
                role = o.optString("role"),
                text = o.optString("text"),
                ts = o.optLong("ts"),
                src = if (o.has("src")) o.optString("src") else null,
            )
        }
    }

    fun parseProjects(body: String): List<ProjectLast> {
        val arr = JSONArray(body)
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            ProjectLast(
                name = o.optString("name"),
                last = o.optString("last"),
                ts = o.optLong("ts"),
            )
        }
    }

    fun parseStatus(body: String): List<MachineStatus> {
        val machines = JSONObject(body).optJSONObject("machines") ?: return emptyList()
        return machines.keys().asSequence().mapNotNull { key ->
            val m = machines.optJSONObject(key) ?: return@mapNotNull null
            val ips = m.optJSONArray("lanIPs") ?: JSONArray()
            MachineStatus(
                name = key,
                lanIPs = (0 until ips.length()).map { ips.optString(it) },
                running = countOf(m.opt("running")),
                queued = countOf(m.opt("queued")),
            )
        }.toList()
    }

    /** running/queued 可能是数字也可能是数组,统一成数量。 */
    private fun countOf(value: Any?): Int = when (value) {
        is Number -> value.toInt()
        is JSONArray -> value.length()
        else -> 0
    }
}
