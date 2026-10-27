import QtQuick
import QtQuick.Controls as QQC
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons // qmllint disable import
import qs.Ui // qmllint disable import
import "SettingsModel.js" as SettingsModel

// Meeting Mode settings overlay: `omarchy-shell meeting-mode settings`, or
// right-click the bar indicator. Up/Down pick a row, Left/Right change it,
// Space/Enter flip switches, Escape closes. Every change is saved at once
// and used from the next meeting.
Item {
    id: root

    property var shell: null
    property var manifest: null
    readonly property string pluginId: String((root.manifest && root.manifest.id) || "nixarchy.meeting-mode")

    property bool opened: false
    property int cursor: 0
    property var state: ({})

    SettingsStore {
        id: store
        shell: root.shell
        pluginId: root.pluginId
    }

    readonly property var rows: [
        { key: "dnd", label: "Do Not Disturb", hint: "Silence notification pop-ups during the call", toggle: true },
        { key: "awake", label: "Stay awake", hint: "No idle lock or screen blank while you listen", toggle: true },
        { key: "nightlight", label: "Night light off", hint: "Keep your camera picture its true colour", toggle: true },
        { key: "voice", label: "Pause voice control", hint: "Stop nixarchy voice, wake word included, during the call, if it is running", toggle: true },
        { key: "pauseMedia", label: "Pause music and videos", hint: "Pauses what is playing and resumes it after the call", toggle: true },
        { key: "notify", label: "Notifications", hint: "Say when meeting mode starts and ends", toggle: true },
        { key: "endDelay", label: "After a call ends", hint: "Wait this long before putting everything back", options: SettingsModel.END_DELAY_OPTIONS },
        { key: "nativeApps", label: "Call apps", hint: "Apps that count as a call as soon as they use the microphone (regular expression, matched against the app name)", text: true },
        { key: "browsers", label: "Browsers", hint: "A browser on the microphone is only a maybe until a meeting window or screen share confirms it, or the delay below passes", text: true },
        { key: "meetingTitles", label: "Meeting window titles", hint: "One regular expression per line, matched against window titles. Titles are never logged. Empty means no title confirmation.", text: true, multiline: true },
        { key: "maybeDelay", label: "Treat browser mic as a call after (s)", hint: "10 to 600 seconds", text: true, number: true }
    ]

    readonly property string statusLine: {
        var s = root.state;
        if (s.active) return "On now · " + (s.reason === "manual" ? "turned on by hand" : "call in " + s.reason);
        if (s.suppressed) return "Off for this call (turned off by hand)";
        return "Waiting for a call. Turns on when a call app uses your microphone.";
    }

    function open(payloadJson) {
        root.opened = true;
        root.cursor = 0;
        stateIn.reload();
        Qt.callLater(function() { keyCatcher.forceActiveFocus(); });
    }

    function close() {
        root.opened = false;
    }

    function dismiss() {
        root.opened = false;
        if (root.shell && typeof root.shell.hide === "function")
            root.shell.hide(root.pluginId);
    }

    function valueFor(row) {
        var v = store.values[row.key];
        return row.key === "endDelay" || row.number ? String(v) : v;
    }

    function apply(row, value) {
        store.set(row.key, row.key === "endDelay" || row.number ? Number(value) : value);
    }

    signal edit(int index)

    function shift(row, delta) {
        if (row.text) return;
        if (row.toggle) {
            store.set(row.key, !store.values[row.key]);
            return;
        }
        var current = String(root.valueFor(row));
        var index = 0;
        for (var i = 0; i < row.options.length; i++)
            if (row.options[i].value === current)
                index = i;
        var next = Math.max(0, Math.min(row.options.length - 1, index + delta));
        root.apply(row, row.options[next].value);
    }

    FileView {
        id: stateIn
        path: SettingsModel.statePath(Quickshell.env("XDG_RUNTIME_DIR"), Quickshell.env("XDG_STATE_HOME"), Quickshell.env("HOME"))
        watchChanges: true
        printErrors: false
        onFileChanged: reload()
        onLoaded: {
            try { root.state = JSON.parse(text()); } catch (e) {}
        }
    }

    PanelWindow { // qmllint disable uncreatable-type
        id: win
        visible: root.opened
        anchors { top: true; bottom: true; left: true; right: true }
        color: "transparent"
        exclusionMode: ExclusionMode.Ignore
        WlrLayershell.namespace: "meeting-mode-settings"
        WlrLayershell.layer: WlrLayer.Overlay
        WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive

        Rectangle {
            anchors.fill: parent
            color: Color.menu.scrim
        }

        MouseArea {
            anchors.fill: parent
            onClicked: root.dismiss()
        }

        BorderSurface {
            id: card
            anchors.centerIn: parent
            width: Style.space(620)
            // Never taller than the screen: the rows scroll.
            height: Math.min(body.implicitHeight + card.contentTopInset + card.contentBottomInset, win.height - Style.space(48))
            radius: Style.cornerRadius
            color: Color.menu.background
            borderSpec: Border.surfaceSpec("menu", "border", Color.menu.border, Math.max(1, Style.space(2)))
            padding: Style.spacing.panelPadding

            MouseArea { anchors.fill: parent }

            Item {
                id: keyCatcher
                anchors.fill: parent
                focus: true
                Keys.onPressed: function(event) {
                    var row = root.rows[root.cursor];
                    if (event.key === Qt.Key_Escape)
                        root.dismiss();
                    else if (event.key === Qt.Key_Down || event.key === Qt.Key_J || event.key === Qt.Key_Tab)
                        root.cursor = (root.cursor + 1) % root.rows.length;
                    else if (event.key === Qt.Key_Up || event.key === Qt.Key_K || event.key === Qt.Key_Backtab)
                        root.cursor = (root.cursor + root.rows.length - 1) % root.rows.length;
                    else if (event.key === Qt.Key_Right || event.key === Qt.Key_L)
                        root.shift(row, 1);
                    else if (event.key === Qt.Key_Left || event.key === Qt.Key_H)
                        root.shift(row, -1);
                    else if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && row.text)
                        root.edit(root.cursor);
                    else if ((event.key === Qt.Key_Space || event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && row.toggle)
                        root.shift(row, 1);
                    else
                        return;
                    event.accepted = true;
                }
            }

            Flickable {
                id: scroller
                x: card.contentLeftInset
                y: card.contentTopInset
                width: card.width - card.contentLeftInset - card.contentRightInset
                height: card.height - card.contentTopInset - card.contentBottomInset
                contentWidth: width
                contentHeight: body.implicitHeight
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                interactive: contentHeight > height

                // Keep the row under the cursor in view.
                function reveal(index) {
                    var item = rowList.itemAt(index);
                    if (!item) return;
                    if (item.y < scroller.contentY)
                        scroller.contentY = item.y;
                    else if (item.y + item.height > scroller.contentY + scroller.height)
                        scroller.contentY = Math.min(item.y + item.height - scroller.height, scroller.contentHeight - scroller.height);
                }
                Connections {
                    target: root
                    function onCursorChanged() { scroller.reveal(root.cursor); }
                }

            Column {
                id: body
                width: scroller.width
                spacing: Style.spacing.md

                Text {
                    textFormat: Text.PlainText
                    text: "Meeting Mode"
                    color: Color.menu.text
                    font.family: Style.font.menuFamily
                    font.pixelSize: Style.font.heading
                    font.bold: true
                }
                Text {
                    textFormat: Text.PlainText
                    width: parent.width
                    wrapMode: Text.Wrap
                    text: root.statusLine
                    color: root.state.active ? Color.urgent : Color.menu.text
                    opacity: root.state.active ? 1 : 0.65
                    font.family: Style.font.menuFamily
                    font.pixelSize: Style.font.bodySmall
                    bottomPadding: Style.spacing.md
                }

                Repeater {
                    id: rowList
                    model: root.rows

                    Rectangle {
                        id: rowItem
                        required property var modelData
                        required property int index
                        readonly property bool current: index === root.cursor
                        property string error: ""   // why the last edit was not saved

                        // Saves unless the text is not a valid pattern; then the
                        // previous value stays and the reason shows under the field.
                        function commit(text) {
                            rowItem.error = SettingsModel.regexError(rowItem.modelData.key, text);
                            if (rowItem.error === "")
                                root.apply(rowItem.modelData, text);
                        }
                        width: body.width
                        height: rowContent.implicitHeight + Style.spacing.lg * 2
                        radius: Style.cornerRadius
                        color: current ? Color.menu.selectedBackground : "transparent"

                        MouseArea {
                            anchors.fill: parent
                            hoverEnabled: true
                            onPositionChanged: root.cursor = rowItem.index
                            onClicked: if (rowItem.modelData.toggle) root.shift(rowItem.modelData, 1)
                        }

                        Item {
                            id: rowContent
                            x: Style.spacing.rowPaddingX
                            width: parent.width - Style.spacing.rowPaddingX * 2
                            anchors.verticalCenter: parent.verticalCenter
                            implicitHeight: rowItem.modelData.text ? labels.implicitHeight + Style.spacing.md + editor.height + (rowItem.error !== "" ? errorText.implicitHeight + Style.spacing.md : 0) : Math.max(labels.implicitHeight, control.height)

                            Column {
                                id: labels
                                anchors.left: parent.left
                                anchors.right: rowItem.modelData.text ? parent.right : control.left
                                anchors.rightMargin: rowItem.modelData.text ? 0 : Style.spacing.huge
                                anchors.top: rowItem.modelData.text ? parent.top : undefined
                                anchors.verticalCenter: rowItem.modelData.text ? undefined : parent.verticalCenter
                                spacing: Style.spacing.xxs

                                Text {
                                    textFormat: Text.PlainText
                                    text: rowItem.modelData.label
                                    color: rowItem.current ? Color.menu.selectedText : Color.menu.text
                                    font.family: Style.font.menuFamily
                                    font.pixelSize: Style.font.body
                                }
                                Text {
                                    textFormat: Text.PlainText
                                    visible: text !== ""
                                    width: parent.width
                                    wrapMode: Text.Wrap
                                    text: rowItem.modelData.hint
                                    color: Color.menu.text
                                    opacity: 0.55
                                    font.family: Style.font.menuFamily
                                    font.pixelSize: Style.font.caption
                                }
                            }

                            Item {
                                id: control
                                anchors.right: parent.right
                                anchors.verticalCenter: parent.verticalCenter
                                width: rowItem.modelData.text ? 0 : (rowItem.modelData.toggle ? toggle.width : group.width)
                                height: rowItem.modelData.text ? 0 : (rowItem.modelData.toggle ? toggle.height : group.height)

                                ButtonGroup {
                                    id: group
                                    visible: !rowItem.modelData.toggle && !rowItem.modelData.text
                                    focusable: false
                                    options: rowItem.modelData.options || []
                                    value: String(root.valueFor(rowItem.modelData))
                                    fontFamily: Style.font.menuFamily
                                    fontSize: Style.font.caption
                                    onChanged: function(value) { root.apply(rowItem.modelData, value); }
                                }
                                ToggleSwitch {
                                    id: toggle
                                    visible: !!rowItem.modelData.toggle
                                    checked: root.valueFor(rowItem.modelData) === true
                                    hasCursor: rowItem.current
                                    onToggled: root.shift(rowItem.modelData, 1)
                                }
                            }

                            // Saved when the field loses focus; Escape leaves the field.
                            Item {
                                id: editor
                                visible: !!rowItem.modelData.text
                                anchors.top: labels.bottom
                                anchors.topMargin: Style.spacing.md
                                width: parent.width
                                height: rowItem.modelData.multiline ? Style.space(110) : (rowItem.modelData.number ? numberField.implicitHeight : singleField.implicitHeight)

                                Connections {
                                    target: root
                                    function onEdit(i) {
                                        if (i !== rowItem.index) return;
                                        if (rowItem.modelData.multiline) area.forceActiveFocus();
                                        else if (rowItem.modelData.number) numberField.field.forceActiveFocus();
                                        else singleField.forceActiveFocus();
                                    }
                                }

                                TextField {
                                    id: singleField
                                    visible: !rowItem.modelData.multiline && !rowItem.modelData.number
                                    width: parent.width
                                    text: String(root.valueFor(rowItem.modelData))
                                    foreground: Color.menu.text
                                    font.family: Style.font.menuFamily
                                    font.pixelSize: Style.font.bodySmall
                                    onActiveFocusChanged: if (activeFocus) root.cursor = rowItem.index
                                    onEditingFinished: rowItem.commit(text)
                                    Keys.onEscapePressed: keyCatcher.forceActiveFocus()
                                }
                                // The shown value is the saved, clamped one.
                                NumberField {
                                    id: numberField
                                    visible: !!rowItem.modelData.number
                                    from: 10
                                    to: 600
                                    value: Number(root.valueFor(rowItem.modelData))
                                    foreground: Color.menu.text
                                    fontFamily: Style.font.menuFamily
                                    fontSize: Style.font.bodySmall
                                    hasCursor: rowItem.current
                                    onModified: function(v) { root.apply(rowItem.modelData, v); }
                                }
                                QQC.ScrollView {
                                    visible: !!rowItem.modelData.multiline
                                    anchors.fill: parent
                                    QQC.TextArea {
                                        id: area
                                        text: String(root.valueFor(rowItem.modelData))
                                        color: Color.menu.text
                                        font.family: Style.font.menuFamily
                                        font.pixelSize: Style.font.bodySmall
                                        wrapMode: TextEdit.NoWrap
                                        leftPadding: Style.spacing.controlPaddingX
                                        rightPadding: Style.spacing.controlPaddingX
                                        topPadding: Style.spacing.inputPaddingY
                                        bottomPadding: Style.spacing.inputPaddingY
                                        selectionColor: Style.selectionFillFor(Color.menu.text, Color.accent)
                                        selectedTextColor: Color.menu.text
                                        background: BorderSurface {
                                            color: Style.controlFill(area.activeFocus, false, Color.menu.text, Color.accent)
                                            borderSpec: Border.controlSpec(area.activeFocus ? "focus" : "normal", Color.menu.text, Color.accent)
                                            radius: Style.cornerRadius
                                        }
                                        onActiveFocusChanged: {
                                            if (activeFocus) root.cursor = rowItem.index;
                                            else rowItem.commit(text);
                                        }
                                        Keys.onEscapePressed: keyCatcher.forceActiveFocus()
                                    }
                                }
                            }

                            Text {
                                id: errorText
                                textFormat: Text.PlainText
                                visible: rowItem.error !== ""
                                anchors.top: editor.bottom
                                anchors.topMargin: Style.spacing.md
                                width: parent.width
                                wrapMode: Text.Wrap
                                text: rowItem.error
                                color: Color.urgent
                                font.family: Style.font.menuFamily
                                font.pixelSize: Style.font.caption
                            }
                        }
                    }
                }

                Text {
                    textFormat: Text.PlainText
                    width: parent.width
                    wrapMode: Text.Wrap
                    topPadding: Style.spacing.md
                    text: "Run your own commands at the start and end of a call (on-air light, chat status): set onStart and onEnd in this plugin's entry in shell.json."
                    color: Color.menu.text
                    opacity: 0.55
                    font.family: Style.font.menuFamily
                    font.pixelSize: Style.font.caption
                }
                Text {
                    textFormat: Text.PlainText
                    text: "↑↓ choose   ←→ change   space toggle   enter edit text   esc close"
                    color: Color.menu.text
                    opacity: 0.45
                    font.family: Style.font.menuFamily
                    font.pixelSize: Style.font.caption
                }
            }
            }
        }
    }
}
