import math, random, wave, struct, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'public'/'demo'
OUT.mkdir(parents=True,exist_ok=True)
RATE=16000
rng=random.Random(4267)
events=[]
t=.15
while t<24:
    events.append((t,rng.uniform(.09,.28),rng.choice([220,330,440,554,659,880,1108,1320]),rng.uniform(.15,.35)))
    t+=rng.uniform(.21,.62)
def source(t):
    val=0
    for start,duration,freq,volume in events:
        dt=t-start
        if 0<=dt<duration:
            val+=volume*math.sin(math.pi*dt/duration)**2*(math.sin(2*math.pi*freq*dt)+.35*math.sin(2*math.pi*freq*2.03*dt))
    return val
for label,start,length,seed in [('a',0,22,23),('b',2.34,14,98)]:
    noise=random.Random(seed)
    wav=OUT/f'camera-{label}.wav'
    values=[]
    for i in range(int(length*RATE)):
        t=i/RATE
        signal=source(t+start)+noise.uniform(-.085,.085)+.024*math.sin(2*math.pi*(73 if label=='a' else 97)*t)
        values.append(struct.pack('<h',int(max(-1,min(1,signal))*30000)))
    with wave.open(str(wav),'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(RATE);f.writeframes(b''.join(values))
    draw=f"drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='CAMERA {label.upper()}':x=24:y=24:fontsize=32:fontcolor=white:box=1:boxcolor=black@0.6,drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='COMMON TIME %{{pts\\:flt\\:{start}}}':x=24:y=h-52:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.7"
    vf=('hue=h=70,' if label=='b' else '')+draw
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i',f'testsrc2=size=640x360:rate=30:duration={length}','-i',str(wav),'-vf',vf,'-c:v','libx264','-preset','fast','-crf','26','-pix_fmt','yuv420p','-c:a','aac','-b:a','96k','-movflags','+faststart','-shortest',str(OUT/f'camera-{label}.mp4')],check=True)
    wav.unlink()
print('Created camera-a.mp4 (22s), camera-b.mp4 (14s); B starts +2.34s; independent noise.')
