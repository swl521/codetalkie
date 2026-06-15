package com.example.codetalkie.data

/** 配对码解析:把扫码/深链文本归一化成 6 位数字配对码。 */
object PairCode {

    private val SIX_DIGITS = Regex("""\b(\d{6})\b""")

    /**
     * 从任意文本里抽出 6 位配对码。
     * 支持:深链 codetalkie://pair?code=123456;裸 6 位数字 "123456"。
     * 抽不到返回 null。
     */
    fun extract(raw: String?): String? {
        val text = raw?.trim().orEmpty()
        if (text.isEmpty()) return null
        // 纯 6 位数字直接用
        if (text.matches(Regex("""\d{6}"""))) return text
        // codetalkie://pair?code=XXXXXX —— 取 code 查询参数(大小写不敏感的 scheme)
        if (text.startsWith("codetalkie://", ignoreCase = true)) {
            val q = text.substringAfter('?', "")
            for (pair in q.split('&')) {
                val (k, v) = pair.split('=', limit = 2).let {
                    (it.getOrNull(0) ?: "") to (it.getOrNull(1) ?: "")
                }
                if (k.equals("code", ignoreCase = true) && v.matches(Regex("""\d{6}"""))) return v
            }
        }
        // 兜底:文本里出现的第一个 6 位数字
        return SIX_DIGITS.find(text)?.groupValues?.get(1)
    }
}
