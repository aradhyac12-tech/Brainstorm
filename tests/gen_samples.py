import docx
from docx.shared import Pt
from docx.enum.text import WD_COLOR_INDEX
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
import random
random.seed(1)
Q=[("Which drug is a beta-blocker?",["Atenolol","Amlodipine","Losartan","Enalapril"],0),
("Antidote for paracetamol overdose is",["Naloxone","N-acetylcysteine","Flumazenil"],1),
("Target INR 2.5-3.5 applies to",["Mechanical mitral valve","Stroke","DVT","AF"],0),
("Drug of choice for anaphylaxis",["Adrenaline","Hydrocortisone","Salbutamol","Atropine","Chlorphenamine"],0),
("First-line for H. pylori includes",["Clarithromycin","Gentamicin","Vancomycin","Metformin"],0),
("Which causes ototoxicity?",["Gentamicin","Amoxicillin","Cefazolin","Omeprazole"],0),
("Vitamin K antagonist is",["Warfarin","Heparin","Apixaban","Aspirin"],0),
("Opioid antagonist",["Naloxone","Morphine","Codeine","Tramadol"],0),
("Which is a PPI?",["Pantoprazole","Famotidine","Sucralfate","Ranitidine"],0),
("Drug for pseudomembranous colitis",["Vancomycin","Ampicillin","Cefazolin","Tetracycline"],0)]*3
Q=[(f"{q} (v{i})",o,a) for i,(q,o,a) in enumerate(Q)]
def labels(style,k):
    return {'A)':'ABCDEFGH','a.':'abcdefgh','1)':'12345678','1.':'12345678','(a)':'abcdefgh'}[style][k]
def fmt(style,k):
    l=labels(style,k)
    return {'A)':f'{l}) ','a.':f'{l}. ','1)':f'{l}) ','1.':f'{l}. ','(a)':f'({l}) '}[style]
def mkdocx(name,qstyle,ostyle,mark):
    d=docx.Document()
    for i,(q,o,a) in enumerate(Q,1):
        d.add_paragraph(qstyle.format(n=i)+q)
        for k,t in enumerate(o):
            p=d.add_paragraph(fmt(ostyle,k)+t)
            if k==a and mark=='hl':
                for r in p.runs:r.font.highlight_color=WD_COLOR_INDEX.YELLOW
            if k==a and mark=='bold':
                for r in p.runs:r.bold=True
            if k==a and mark=='star': p.runs[0].text+=' *'
    if mark=='key':
        d.add_paragraph('Answer key')
        d.add_paragraph(' '.join(f'{i}-{"ABCDE"[a]}' for i,(q,o,a) in enumerate(Q,1)))
    d.save(name)
def mkpdf(name,qstyle,ostyle,hl=True,caps=False,inline=False):
    c=canvas.Canvas(name,pagesize=A4);y=800
    def line(t,hlit=False):
        nonlocal y
        if y<60:c.showPage();y=800
        if hlit:
            c.setFillColorRGB(0,1,1);c.rect(48,y-3,c.stringWidth(t,'Helvetica',10)+4,12,stroke=0,fill=1);c.setFillColorRGB(0,0,0)
        c.setFont('Helvetica',10);c.drawString(50,y,t);y-=14
    for i,(q,o,a) in enumerate(Q,1):
        line(qstyle.format(n=i)+(q.upper() if caps else q))
        if inline:
            line('   '+'  '.join(fmt(ostyle,k)+t for k,t in enumerate(o)))
        else:
            for k,t in enumerate(o):line('   '+fmt(ostyle,k)+t,hl and k==a)
        y-=4
    c.save()
mkdocx('d1_hl.docx','{n}. ','A)','hl')
mkdocx('d2_bold.docx','Question {n}: ','1.','bold')
mkdocx('d3_star.docx','Q{n}. ','(a)','star')
mkdocx('d4_key.docx','{n}) ','a.','key')
mkdocx('d5_num_num.docx','{n}. ','1)','hl')
mkpdf('p1.pdf','{n}. ','A)')
mkpdf('p2.pdf','{n}. ','1)',caps=True)
mkpdf('p3.pdf','{n}. ','1.')
mkpdf('p4.pdf','Q{n}. ','a.')
mkpdf('p5.pdf','{n}. ','A)',inline=True)
mkpdf('p6.pdf','{n}) ','a)' if False else 'A)')
print('done')
