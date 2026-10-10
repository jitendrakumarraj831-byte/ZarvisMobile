package com.zarvismobile.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.LinkInteractionListener
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.zarvismobile.domain.presentation.Markdown
import com.zarvismobile.domain.presentation.MdBlock
import com.zarvismobile.domain.presentation.MdSpan

/**
 * A chat reply drawn with its Markdown: headings, bullet and numbered lists, block quotes, rules, fenced and inline code,
 * bold, italic, strikethrough and links. The parsing (and what it refuses to treat as a link) is
 * `com.zarvismobile.domain.presentation.Markdown`, which has its own unit tests; this only draws what it returns. Tables are
 * not drawn as tables yet: they show as the plain text lines they arrived as.
 */
@Composable
fun MarkdownText(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyLarge,
    color: Color = Color.Unspecified,
) {
    val blocks = remember(text) { Markdown.parse(text) }
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        for (block in blocks) MarkdownBlockView(block, style, color)
    }
}

@Composable
private fun MarkdownBlockView(block: MdBlock, style: TextStyle, color: Color) {
    when (block) {
        is MdBlock.Line -> if (block.spans.isNotEmpty()) Text(text = inlineText(block.spans), style = style, color = color)
        is MdBlock.Heading -> Text(
            text = inlineText(block.spans),
            style = when (block.level) {
                1 -> MaterialTheme.typography.titleLarge
                2 -> MaterialTheme.typography.titleMedium
                else -> MaterialTheme.typography.titleSmall
            }.copy(fontWeight = FontWeight.Bold),
            color = color,
            modifier = Modifier.padding(top = 6.dp),
        )
        is MdBlock.ListBlock -> Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            block.items.forEachIndexed { index, item ->
                Row {
                    Text(
                        text = if (block.ordered) "${block.start + index}." else "•",
                        style = style,
                        color = color,
                        modifier = Modifier.width(28.dp),
                    )
                    Text(text = inlineText(item), style = style, color = color, modifier = Modifier.weight(1f))
                }
            }
        }
        is MdBlock.Quote -> Row(modifier = Modifier.height(IntrinsicSize.Min)) {
            Box(
                modifier = Modifier
                    .width(3.dp)
                    .fillMaxHeight()
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.5f)),
            )
            Column(modifier = Modifier.padding(start = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                for (line in block.lines) {
                    if (line.isEmpty()) Spacer(Modifier.height(4.dp)) else Text(text = inlineText(line), style = style, color = color)
                }
            }
        }
        is MdBlock.Code -> CodeBlockView(block.language, block.code)
        MdBlock.Rule -> HorizontalDivider(modifier = Modifier.padding(vertical = 6.dp))
        MdBlock.Gap -> Spacer(Modifier.height(6.dp))
    }
}

@Composable
private fun CodeBlockView(language: String, code: String) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f),
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
    ) {
        Column(modifier = Modifier.padding(10.dp)) {
            if (language.isNotBlank()) {
                Text(text = language, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(
                text = code,
                style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                softWrap = false,
                modifier = Modifier.horizontalScroll(rememberScrollState()),
            )
        }
    }
}

@Composable
private fun inlineText(spans: List<MdSpan>): AnnotatedString {
    val uriHandler = LocalUriHandler.current
    val codeBackground = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.10f)
    val linkColor = MaterialTheme.colorScheme.primary
    return remember(spans, uriHandler, codeBackground, linkColor) {
        // A phone without a browser must not crash the chat when a link is tapped: the tap just does nothing.
        val open = LinkInteractionListener { link -> if (link is LinkAnnotation.Url) runCatching { uriHandler.openUri(link.url) } }
        val linkStyles = TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline))
        buildAnnotatedString {
            for (span in spans) {
                val look = SpanStyle(
                    fontWeight = if (span.bold) FontWeight.Bold else null,
                    fontStyle = if (span.italic) FontStyle.Italic else null,
                    textDecoration = if (span.strike) TextDecoration.LineThrough else null,
                    fontFamily = if (span.code) FontFamily.Monospace else null,
                    background = if (span.code) codeBackground else Color.Unspecified,
                )
                val address = span.link
                if (address == null) {
                    withStyle(look) { append(span.text) }
                } else {
                    withLink(LinkAnnotation.Url(address, linkStyles, open)) { withStyle(look) { append(span.text) } }
                }
            }
        }
    }
}
