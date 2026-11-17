# 导入样式演示

这是一段正文，包含**加粗**、`行内代码`和普通文本。

> [!tip]
> `putSync`/`getSync` 之后要调用 `flushSync()` 才会真正落盘，异步版本用 `flush()`。

> [!warning]
> `clear()` 会删掉所有键值，谨慎使用。

> [!note]
> 四种高亮块标签：tip / note / warning / important，也接受中文别名（提示/注意/警告/重要）。

> [!important]
> 高亮块内同样支持**加粗**和 `code`。

无序与有序列表：

- 第一项
- 第二项

1. 步骤一
2. 步骤二

```typescript
@State draft: string = '';
TextInput({ text: $$this.draft })
```

下面这张图的图题来自 alt 文本：

![图x-1 示例图题](example.png)

| 装饰器 | 方向 | 适用场景 |
|---|---|---|
| `@State` | 组件内部 | 自身状态 |
| `@Link` | 父到子双向 | 父子共享 |
| `@Prop` | 父到子单向 | 只读传递 |
<!-- cols 3:2:4 -->

| A | B |
|---|---|
| 1 | 2 |

分割线：

---
