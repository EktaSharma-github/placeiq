' Exports Office files with the installed Microsoft Office (late binding, no type library needed).
'   cscript //nologo office_export.vbs pptx-pdf  <in.pptx> <out.pdf>
'   cscript //nologo office_export.vbs pptx-png  <in.pptx> <out_folder>
'   cscript //nologo office_export.vbs docx-pdf  <in.docx> <out.pdf>     (updates the table of contents first)
Option Explicit
Dim mode, src, dst, app, doc, i
mode = WScript.Arguments(0)
src = WScript.Arguments(1)
dst = WScript.Arguments(2)

If Left(mode, 4) = "pptx" Then
    Set app = CreateObject("PowerPoint.Application")
    Set doc = app.Presentations.Open(src, True, False, False)
    If mode = "pptx-pdf" Then
        doc.SaveAs dst, 32          ' ppSaveAsPDF
    Else
        doc.SaveAs dst, 18          ' ppSaveAsPNG: one image per slide
    End If
    doc.Close
    app.Quit
Else
    Set app = CreateObject("Word.Application")
    app.Visible = False
    app.DisplayAlerts = 0
    ' Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles)
    ' Read-only: never contends for the file with another Word instance.
    Set doc = app.Documents.Open(src, False, True, False)
    For i = 1 To doc.TablesOfContents.Count
        doc.TablesOfContents(i).Update
    Next
    doc.SaveAs2 dst, 17              ' wdFormatPDF
    doc.Close 0                      ' wdDoNotSaveChanges
    app.Quit
End If
WScript.Echo "ok " & dst
