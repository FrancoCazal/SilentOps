"""SilentOps architecture diagrams. Draws locally without calling services."""
from pathlib import Path
from html import escape
from math import atan2, cos, sin
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent
W, H, SCALE = 1920, 1080, 2
BG = '#091521'
PANEL = '#122536'
TEXT = '#f1f6fa'
MUTED = '#aebfce'
GREEN = '#68e5b2'
BLUE = '#7dc7f7'
PURPLE = '#c3b0fc'
AMBER = '#f7ce83'
LINE = '#708fa6'
FONT = Path('C:/Windows/Fonts/segoeui.ttf')
BOLD = Path('C:/Windows/Fonts/seguisb.ttf')


class Canvas:
    def __init__(self, title, subtitle):
        self.image = Image.new('RGB', (W*SCALE, H*SCALE), BG)
        self.draw = ImageDraw.Draw(self.image)
        self.svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080" role="img"><title>{escape(title)}</title><desc>{escape(subtitle)}</desc>', f'<rect width="1920" height="1080" fill="{BG}"/>']
        self.text(70, 46, 'SILENTOPS  /  CONTINUITY BETWEEN SHIFTS', 16, GREEN, True)
        self.text(70, 80, title, 48, TEXT, True)
        self.text(70, 148, subtitle, 23, MUTED)

    def font(self, size, bold=False):
        return ImageFont.truetype(str(BOLD if bold else FONT), round(size*SCALE))

    def text(self, x, y, content, size=20, color=TEXT, bold=False, align='left'):
        font = self.font(size, bold)
        anchor = {'left':'lt', 'center':'mt', 'right':'rt'}[align]
        self.draw.text((x*SCALE, y*SCALE), content, font=font, fill=color, anchor=anchor)
        svg_anchor = {'left':'start', 'center':'middle', 'right':'end'}[align]
        self.svg.append(f'<text x="{x}" y="{y}" fill="{color}" font-family="Segoe UI,Arial,sans-serif" font-size="{size}" font-weight="{600 if bold else 400}" text-anchor="{svg_anchor}" dominant-baseline="text-before-edge">{escape(content)}</text>')

    def lines(self, x, y, values, size=20, color=TEXT, bold=False, gap=None, align='left'):
        for i, value in enumerate(values):
            self.text(x, y+i*(gap or size*1.4), value, size, color, bold, align)

    def rect(self, x, y, w, h, fill=PANEL, stroke=LINE, radius=16, width=1.5):
        self.draw.rounded_rectangle((x*SCALE,y*SCALE,(x+w)*SCALE,(y+h)*SCALE), radius=radius*SCALE, fill=fill, outline=stroke, width=round(width*SCALE))
        self.svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}" stroke-width="{width}"/>')

    def box(self, x, y, w, h, tag, title, body, accent=BLUE, title_size=23, body_size=18):
        self.rect(x,y,w,h,stroke=accent)
        self.text(x+20,y+17,tag,13,accent,True)
        titles = title if isinstance(title,list) else [title]
        self.lines(x+20,y+42,titles,title_size,TEXT,True,gap=title_size+5)
        self.lines(x+20,y+49+len(titles)*(title_size+5),body,body_size,MUTED,gap=body_size+8)

    def path(self, points, color=LINE, width=2.5, end=True, start=False):
        xy = [(round(x*SCALE),round(y*SCALE)) for x,y in points]
        self.draw.line(xy, fill=color, width=round(width*SCALE), joint='curve')
        coords = ' '.join(f'{x},{y}' for x,y in points)
        self.svg.append(f'<polyline points="{coords}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>')
        if end:
            self.arrowhead(points[-2],points[-1],color)
        if start:
            self.arrowhead(points[1],points[0],color)

    def arrowhead(self, previous, end, color):
        angle = atan2(end[1]-previous[1],end[0]-previous[0])
        pts = [end, (end[0]-11*cos(angle)+5*sin(angle),end[1]-11*sin(angle)-5*cos(angle)), (end[0]-11*cos(angle)-5*sin(angle),end[1]-11*sin(angle)+5*cos(angle))]
        self.draw.polygon([(round(x*SCALE),round(y*SCALE)) for x,y in pts],fill=color)
        self.svg.append(f'<polygon points="{" ".join(f"{x:.1f},{y:.1f}" for x,y in pts)}" fill="{color}"/>')

    def diamond(self, x, y, w, h, labels):
        pts = [(x+w/2,y),(x+w,y+h/2),(x+w/2,y+h),(x,y+h/2)]
        self.draw.polygon([(round(a*SCALE),round(b*SCALE)) for a,b in pts],fill='#163629',outline=GREEN,width=3)
        self.svg.append(f'<polygon points="{" ".join(f"{a},{b}" for a,b in pts)}" fill="#163629" stroke="{GREEN}" stroke-width="1.5"/>')
        self.lines(x+w/2,y+h/2-29,labels,22,TEXT,True,gap=29,align='center')

    def footer(self, text):
        self.path([(70,1008),(1850,1008)],'#284154',1,end=False)
        self.text(70,1028,text,18,MUTED)
        self.text(1850,1028,'Club de Programación FIUNA',17,GREEN,True,align='right')

    def save(self, name):
        self.image.save(OUT/f'{name}.png',optimize=True)
        (OUT/f'{name}.svg').write_text('\n'.join(self.svg+['</svg>']),encoding='utf-8')


def architecture():
    c = Canvas('How SilentOps connects', 'Slack brings people together; the backend coordinates work; Ambiguous stores the records.')
    c.rect(500,439,1350,232,fill='#0d1f2e',stroke='#2b475d',radius=22)
    c.text(525,449,'PACKAGES / LOOP-CORE',14,GREEN,True)
    # Connections behind their nodes.
    c.path([(398,376),(398,483)],GREEN,start=True)
    c.path([(422,563),(540,563)],GREEN)
    c.path([(940,563),(995,563)],GREEN)
    c.path([(1335,563),(1400,563)],GREEN)
    c.path([(740,376),(740,483)],PURPLE,start=True)
    c.path([(1165,376),(1165,413),(846,413),(846,483)],BLUE,start=True)
    c.path([(1215,376),(1215,398),(1660,398),(1660,483)],BLUE,start=True)
    c.path([(1540,376),(1540,483)],AMBER,start=True)
    c.path([(1170,641),(1170,721),(245,721),(245,641)],GREEN,start=True)
    c.path([(1235,641),(1235,821)],LINE)
    c.path([(1660,641),(1660,821)],LINE,start=True)
    # Primary boxes.
    c.box(70,225,352,151,'PEOPLE AND CHANNEL','Slack',['Supervisor and team','Mention, card and human decision'],GREEN)
    c.box(70,483,352,158,'APPS / CHANNEL','Node.js server',['Receives events and posts cards','Watches the thread; schedules checks'],GREEN,body_size=17)
    c.text(79,408,'CopilotKit Intelligence / Channels',15,GREEN)
    c.text(80,431,'Outbound WebSocket from Node',15,MUTED)
    c.box(540,225,400,151,'AI PROVIDERS','Configured models',['Demo: Gemini Flash → Gemini Pro','Also supports OpenAI / OpenRouter'],PURPLE)
    c.box(995,225,340,151,'WORKSPACE','Ambiguous',['Roster · documents','Messages · work orders'],BLUE)
    c.box(1400,225,450,151,'SERVICE AUTHORIZATION','Auth0',['M2M token + scopes per action','Does not identify the Slack supervisor'],AMBER)
    c.box(540,483,400,158,'READ AND PROPOSE','Detector + agent',['BuiltInAgent / CopilotKit Runtime','withFallback retries a failed run'],PURPLE)
    c.box(995,483,340,158,'DECISION','Proposal + approval',['A human reviews it in Slack','The decision is persisted'],GREEN)
    c.box(1400,483,450,158,'WRITE','Write boundary',['Checks scope and looks up the key','MCP writer + output to the Slack thread'],AMBER)
    c.text(963,389,'MCP reads',14,BLUE)
    c.text(1255,410,'Approved writes · MCP',14,BLUE)
    c.text(1690,431,'Permissions per action',14,AMBER)
    c.text(513,743,'Cards, decisions and results return to the watched thread',18,GREEN)
    # Supporting surfaces are visibly separate from operational flow.
    c.box(70,821,352,151,'APPS / WEB · NEXT.JS','Demo interface',['Landing, access and console','The console still simulates its actions'],BLUE,body_size=17)
    c.box(540,821,400,151,'PACKAGES / AGENT-CORE','Shared configuration',['Resolves the provider:model reference','Runtime makes the model call'],PURPLE,body_size=17)
    c.box(995,821,855,151,'LOCAL STATE','JSON files',['Proposals + results indexed by idempotency key','Local storage is neither a distributed database nor a job queue.'],BLUE,body_size=19)
    c.footer('Code architecture · mobile, voice and kit-demo are inherited interfaces outside the Tier 0 flow.')
    c.save('01-arquitectura-silentops')


def flow():
    c = Canvas('From a missing handover to human approval', 'Demo example: at 05:45, the shift ends at 06:00 and the handover document is missing.')
    y,h = 340,194
    # Happy path and branches.
    c.path([(306,437),(333,437)],GREEN)
    c.path([(570,437),(592,437)],GREEN)
    c.path([(806,437),(833,437)],GREEN)
    c.path([(1084,437),(1109,437)],GREEN)
    c.path([(1348,437),(1373,437)],GREEN)
    c.path([(1608,437),(1632,437)],GREEN)
    c.path([(699,340),(699,300)],BLUE)
    c.path([(1229,340),(1229,300)],AMBER)
    c.path([(1490,340),(1490,300)],AMBER)
    # Auxiliary context/model/state.
    c.path([(451,534),(451,641)],BLUE,start=True)
    c.path([(958,534),(958,641)],PURPLE,start=True)
    c.path([(1280,534),(1280,599),(1400,599),(1400,641)],LINE)
    c.path([(1530,534),(1530,641)],LINE,start=True)
    c.box(70,y,236,h,'1 · SLACK',['Start','monitoring'],['A person mentions','the bot in the thread.'],GREEN)
    c.box(333,y,237,h,'2 · DETECTOR',['Check','the shift'],['Scheduled check:','roster and handover.'],BLUE)
    c.diamond(592,y,214,h,['Handover','missing?'])
    c.box(833,y,251,h,'3 · AGENT',['Prepare','the proposal'],['Evidence of absence,','messages and orders.'],PURPLE)
    c.box(1109,y,239,h,'4 · HUMAN',['Review','and approve'],['Document, orders, notice.','High risk: confirm again.'],GREEN,body_size=17)
    c.box(1373,y,235,h,'5 · BOUNDARY',['Authorize','and execute'],['Scope + key per action.','MCP writer / Slack output.'],AMBER,body_size=16)
    c.box(1632,y,218,h,'6 · RESULT',['Confirm','the handover'],['Records in Ambiguous','and result in the thread.'],GREEN,body_size=16)
    c.text(819,409,'Yes',14,GREEN,True,align='center')
    # Alternative outcomes, before execution only.
    c.rect(579,215,240,85,stroke=BLUE)
    c.text(699,231,'ALREADY EXISTS',14,BLUE,True,align='center')
    c.text(699,258,'No new proposal',19,TEXT,align='center')
    c.text(713,308,'No',14,BLUE)
    c.rect(1109,215,239,85,stroke=AMBER)
    c.text(1229,231,'REJECTED',14,AMBER,True,align='center')
    c.text(1229,258,'Execution does not start',18,TEXT,align='center')
    c.rect(1373,215,235,85,stroke=AMBER)
    c.text(1490,231,'MISSING PERMISSION',13,AMBER,True,align='center')
    c.text(1490,258,'That action is blocked',18,TEXT,align='center')
    c.box(70,641,500,164,'WORK DATA SOURCE','Ambiguous via MCP',['The detector queries workspace data.','If the handover is missing, it attaches the search','and the sources the agent will use.'],BLUE,body_size=18)
    c.box(642,641,442,164,'MODEL WITH FALLBACK','AI proposes; it does not execute',['BuiltInAgent generates the proposal.','If the primary fails, withFallback retries','the run with the alternative model.'],PURPLE,body_size=18)
    c.box(1158,641,692,164,'PERSISTENCE','Approval and results are saved',['Local JSON: proposals and recorded actions.','A retry uses the same proposal and checks','the results already saved.'],BLUE,body_size=19)
    c.rect(70,860,1780,98,fill='#102a27',stroke='#3f7667')
    c.text(93,879,'FOR EACH ACTION',14,GREEN,True)
    c.text(93,908,'Check scope  →  look up key  →  execute if not recorded  →  save the result',25,TEXT,True)
    c.footer('Implemented flow · one approval may contain several actions; a failure can leave partial results.')
    c.save('02-flujo-handover-silentops')


if __name__ == '__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    architecture()
    flow()
    print('Generated 2 PNG + 2 SVG in', OUT)
