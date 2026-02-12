# Leapfrog Chat UI - End-to-End Testing Checklist

## 📋 Testing Overview
This document provides a comprehensive testing checklist for the Leapfrog Chat UI integration with VS Code's ChatViewPane. Follow these steps to verify all functionality works correctly.

---

## 🧪 Pre-Test Setup

- [ ] **Clean installation**: Fresh VS Code session with Leapfrog extension
- [ ] **Test project**: Create or open a test workspace with some files
- [ ] **API keys**: Ensure OpenAI/Anthropic API keys are configured
- [ ] **Model settings**: Verify `leapfrog.chat.defaultModel` is set in settings
- [ ] **Compilation**: Verify 0 compilation errors before testing

---

## ✅ Phase 1: Basic Chat Functionality

### Session Management
- [ ] **New Chat**: Click "New Chat" button creates a new session
- [ ] **Session List**: Multiple sessions appear in the left panel
- [ ] **Session Switch**: Clicking a session loads its messages
- [ ] **Session Title**: New sessions have auto-generated titles
- [ ] **Session Delete**: Can delete sessions from context menu
- [ ] **Persistence**: Close and reopen VS Code, sessions are still there
- [ ] **Message History**: All messages persist across sessions

### Message Sending
- [ ] **Text Input**: Can type messages in the input field
- [ ] **Send Message**: Press Enter or click send button sends message
- [ ] **Empty Message**: Sends error when trying to send empty message
- [ ] **Long Message**: Can send multi-line messages
- [ ] **Special Characters**: Messages with special characters send correctly
- [ ] **Progress Indicator**: Shows typing/loading indicator while waiting for response
- [ ] **Streaming**: Response streams in chunks as it arrives
- [ ] **Full Content**: Complete response displays when finished

---

## ✅ Phase 2: Rich Content Rendering

### Markdown Rendering
- [ ] **Headings**: H1, H2, H3 render with proper styling
- [ ] **Bold**: **bold text** displays correctly
- [ ] **Italic**: *italic text* displays correctly
- [ ] **Links**: [Links](https://example.com) are clickable
- [ ] **Lists**: Bullet and numbered lists render properly
- [ ] **Code Inline**: `inline code` has proper formatting
- [ ] **Blockquotes**: > quoted text displays indented

### Code Blocks
- [ ] **Syntax Highlighting**: Code blocks have syntax highlighting
- [ ] **Language Detection**: Code blocks show correct language
- [ ] **Line Numbers**: (Optional) Line numbers display correctly
- [ ] **Copy Button**: Copy button appears and works
- [ ] **Multiple Blocks**: Multiple code blocks in one response
- [ ] **Long Code**: Very long code blocks are scrollable

### Other Content
- [ ] **Tables**: Markdown tables render properly
- [ ] **Horizontal Rules**: `---` renders as divider
- [ ] **Nested Content**: Nested lists and quotes work
- [ ] **HTML Safety**: HTML tags are not executed

---

## ✅ Phase 3: Slash Commands

### Command Recognition
- [ ] **/ask**: `/ask what does this mean?` works
- [ ] **/tag**: `/tag important topic` works
- [ ] **/search**: `/search research methodology` works
- [ ] **/cross-reference**: `/cross-reference connections` works
- [ ] **/summarize**: `/summarize the findings` works
- [ ] **Autocomplete**: Commands appear in autocomplete
- [ ] **Help Text**: Hover shows command descriptions

### Command Transformation
- [ ] **Ask Command**: /ask passes message to AI unchanged
- [ ] **Tag Command**: /tag adds tagging context to prompt
- [ ] **Search Command**: /search adds search context
- [ ] **Cross-ref Command**: /cross-reference adds connection context
- [ ] **Summarize Command**: /summarize adds summary context
- [ ] **Response Quality**: AI responses match command intent

---

## ✅ Phase 4: File Attachments

### Attachment Selection
- [ ] **File Picker**: Click attachment icon opens file picker
- [ ] **Select File**: Can select file from picker
- [ ] **Multiple Files**: Can attach multiple files
- [ ] **File Types**: Various file types (js, ts, json, txt, etc.) work
- [ ] **Large Files**: Large files (10MB+) are handled
- [ ] **Cancel**: Cancel button dismisses picker

### Attachment Display
- [ ] **Chip Display**: Files show as chips/badges
- [ ] **File Name**: File name displays correctly
- [ ] **Remove Button**: Can remove attachment before sending
- [ ] **Multiple Display**: Multiple attachments display as separate chips
- [ ] **Scrolling**: Many attachments scroll properly

### Attachment in Messages
- [ ] **Content Included**: File content is included in AI context
- [ ] **Small Files**: Small text files show full content
- [ ] **Large Files**: Large files reference URI instead of inline
- [ ] **Code Analysis**: AI correctly analyzes attached code
- [ ] **History**: Attachments persist in message history
- [ ] **Reload**: After reload, attachments still visible

---

## ✅ Phase 5: Settings & Configuration

### Model Selection
- [ ] **Default Model**: Settings show `leapfrog.chat.defaultModel`
- [ ] **Model Options**: gpt-4o, gpt-4o-mini, claude models available
- [ ] **Change Model**: Changing model in settings affects new messages
- [ ] **Model Validation**: Invalid model selection shows error
- [ ] **Fallback**: Invalid model falls back to default

### Other Settings
- [ ] **Chat Settings**: All chat-related settings appear in UI
- [ ] **Description Text**: Setting descriptions are clear
- [ ] **Setting Application**: Changes take effect immediately
- [ ] **Default Values**: Default values are sensible

---

## ✅ Phase 6: Error Handling

### Network Errors
- [ ] **No Connection**: Gracefully handles network timeout
- [ ] **Error Message**: User-friendly error message displays
- [ ] **Retry Possible**: Can retry after network error
- [ ] **Timeout**: Long requests timeout with message

### Configuration Errors
- [ ] **Missing API Key**: Error if API key not configured
- [ ] **Invalid API Key**: Error on invalid credentials
- [ ] **Model Error**: Error if model selection fails
- [ ] **Recovery**: Can fix settings and retry

### Input Errors
- [ ] **Empty Message**: Error when sending empty message
- [ ] **Invalid Command**: Unknown slash command shows error
- [ ] **Attachment Error**: Error handling for file issues
- [ ] **Recovery**: Can retry after fixing input

---

## ✅ Phase 7: UI/UX

### Chat View
- [ ] **View Opens**: Chat view appears in auxiliary bar
- [ ] **View Title**: "Chat" title displays
- [ ] **Keybinding**: Cmd+Shift+I (or configured key) opens chat
- [ ] **View Close**: Can close/open chat view
- [ ] **View Resize**: Chat view resizable

### Input Area
- [ ] **Focus**: Input area is focused on open
- [ ] **Placeholder**: Placeholder text visible
- [ ] **Multi-line**: Can type multiple lines
- [ ] **Auto-grow**: Input area grows with content (if supported)
- [ ] **Button Visible**: Send button is always visible

### Message Display
- [ ] **User Messages**: User messages show with different styling
- [ ] **Assistant Messages**: Assistant messages have different styling
- [ ] **Timestamps**: (Optional) Messages show timestamps
- [ ] **Scrolling**: Message list scrolls to latest message
- [ ] **Selection**: Can select and copy message text

### Styling
- [ ] **Colors**: Leapfrog colors match VS Code theme
- [ ] **Dark Mode**: Works in dark theme
- [ ] **Light Mode**: Works in light theme
- [ ] **High Contrast**: Works in high contrast theme
- [ ] **Spacing**: Proper padding and margins throughout

---

## ✅ Phase 8: Performance & Stability

### Performance
- [ ] **Large Response**: 10,000+ character responses load smoothly
- [ ] **Rapid Messages**: Quickly sending multiple messages works
- [ ] **Many Sessions**: 50+ sessions don't slow down
- [ ] **Memory**: Memory usage stays reasonable over time
- [ ] **Streaming**: Streaming updates happen smoothly

### Stability
- [ ] **No Crashes**: No crashes during normal use
- [ ] **No Memory Leaks**: Memory stable over extended use
- [ ] **Reload Stable**: Reloading window preserves state
- [ ] **Long Sessions**: Can chat for hours without issues
- [ ] **Edge Cases**: Unusual inputs don't crash

---

## ✅ Phase 9: Integration Tests

### Complete Workflow
- [ ] **Workflow 1**: Create session → attach file → send message → receive response → save
  - [ ] Create new chat
  - [ ] Attach a file
  - [ ] Send message asking about the file
  - [ ] Verify response mentions file content
  - [ ] Check file persists in history
  - [ ] Reload and verify history

- [ ] **Workflow 2**: Slash command → AI response → follow-up
  - [ ] Send `/tag important concept`
  - [ ] Receive tagging suggestions
  - [ ] Send follow-up clarification
  - [ ] Verify context is maintained
  - [ ] Switch sessions and back

- [ ] **Workflow 3**: Multiple attachments → analysis
  - [ ] Attach 3 different files
  - [ ] Send `/search` command
  - [ ] AI analyzes all files
  - [ ] Response references each file
  - [ ] Attachments visible in history

- [ ] **Workflow 4**: Model switching → different responses
  - [ ] Send message with gpt-4o
  - [ ] Change to claude-3-5-sonnet-latest in settings
  - [ ] Send same message
  - [ ] Responses differ appropriately
  - [ ] Both models available and working

- [ ] **Workflow 5**: Error recovery → successful retry
  - [ ] Temporarily disable API key
  - [ ] Try to send message
  - [ ] See error message
  - [ ] Re-enable API key
  - [ ] Message sends successfully

---

## 📊 Test Results Summary

### Overall Status
- [ ] **Core Functionality**: PASS / FAIL
- [ ] **Rich Content**: PASS / FAIL
- [ ] **Commands**: PASS / FAIL
- [ ] **Attachments**: PASS / FAIL
- [ ] **Configuration**: PASS / FAIL
- [ ] **Error Handling**: PASS / FAIL
- [ ] **UI/UX**: PASS / FAIL
- [ ] **Performance**: PASS / FAIL

### Issues Found
```
[Document any issues found during testing]

1. Issue #1: ...
   Steps to Reproduce: ...
   Expected: ...
   Actual: ...
   Severity: (Critical/High/Medium/Low)

```

### Notes
```
[Add any additional notes or observations]
```

---

## 🎯 Sign-Off

- [ ] All tests completed
- [ ] All critical issues resolved
- [ ] Documentation updated
- [ ] Ready for production

**Tested By**: _______________
**Date**: _______________
**Version**: 1.0.0

---

## 📝 Regression Testing (Future Releases)

For future releases, run through these key scenarios:

1. **Session Persistence**: Messages persist across reload
2. **Slash Commands**: All 5 commands work correctly
3. **Rich Content**: Markdown and code blocks render
4. **Attachments**: Files can be attached and referenced
5. **Error Handling**: Network errors show friendly messages
6. **Model Selection**: Configuration works correctly
7. **Performance**: Large sessions load quickly
8. **UI Stability**: No crashes or freezing
