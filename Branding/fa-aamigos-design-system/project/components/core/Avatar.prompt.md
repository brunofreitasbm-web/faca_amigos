Circular user avatar. If no src, renders initials (up to 2 chars) on a deterministic brand color. Ring variant wraps in gradient border.

```jsx
<Avatar src="/user.jpg" name="Ana Lima" size={40} />
<Avatar name="Carlos Souza" size={48} />
<Avatar name="Maria" size={56} variant="ring" />
```

Background color is seeded from first char of name — consistent across renders.
