import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt
from scipy.io import wavfile
SR=44100; BPM=96; BEAT=60/BPM; BAR=4*BEAT; NB=16
L=int(NB*BAR*SR); TAIL=int(2*BAR*SR); N=L+TAIL
mix=np.zeros((N,2))
rng=np.random.default_rng(7)
f=lambda m:440*2**((m-69)/12)
def env(n,a,d,s,r,hold):
    t=np.arange(n)/SR; e=np.zeros(n)
    A=int(a*SR);D=int(d*SR);H=int(hold*SR);R=int(r*SR)
    e[:A]=np.linspace(0,1,A,endpoint=False) if A else 1
    k=A; e[k:k+D]=np.linspace(1,s,len(e[k:k+D]))
    k+=D; end=max(k,H); e[k:end]=s
    rr=e[end:end+R]; e[end:end+R]=s*np.linspace(1,0,len(rr))
    e[end+R:]=0; return e
def add(sig,start,pan=0.0,gain=1.0):
    i=int(start*SR); j=min(N,i+len(sig)); sig=sig[:j-i]*gain
    l=np.cos((pan+1)*np.pi/4); r=np.sin((pan+1)*np.pi/4)
    mix[i:j,0]+=sig*l; mix[i:j,1]+=sig*r
def pad(m,dur):
    n=int((dur+1.2)*SR); t=np.arange(n)/SR; x=np.zeros(n)
    for det in (-0.12,0,0.12):
        fr=f(m)*2**(det/12)
        x+=np.sin(2*np.pi*fr*t)+0.35*np.sin(2*np.pi*2*fr*t)+0.12*np.sin(2*np.pi*3*fr*t)
    x*=0.33; return x*env(n,0.45,0.3,0.8,1.1,dur)
def epiano(m,dur,vel=1.0):
    n=int((dur+1.4)*SR); t=np.arange(n)/SR; fr=f(m)
    mod=np.sin(2*np.pi*fr*t)*1.8*np.exp(-t*6)
    x=np.sin(2*np.pi*fr*t+mod)*np.exp(-t*2.2)+0.25*np.sin(2*np.pi*2*fr*t)*np.exp(-t*4)
    return vel*x*env(n,0.004,0.1,1,0.25,dur+0.9)
def bell(m,dur,vel=1.0):
    n=int((dur+2.0)*SR); t=np.arange(n)/SR; fr=f(m)
    x=(np.sin(2*np.pi*fr*t)*np.exp(-t*2.6)+0.45*np.sin(2*np.pi*2*fr*t)*np.exp(-t*4.5)
       +0.18*np.sin(2*np.pi*3.01*fr*t)*np.exp(-t*7)+0.08*np.sin(2*np.pi*4.2*fr*t)*np.exp(-t*10))
    return vel*x*env(n,0.002,0.05,1,0.3,dur+1.6)
def bass(m,dur):
    n=int((dur+0.4)*SR); t=np.arange(n)/SR; fr=f(m)
    x=np.sin(2*np.pi*fr*t)+0.3*np.sin(2*np.pi*2*fr*t)
    return x*np.exp(-t*1.5)*env(n,0.01,0.1,0.9,0.25,dur)
def shaker(dur=0.09):
    n=int(dur*SR); x=rng.standard_normal(n)
    x=sosfilt(butter(4,6000,'hp',fs=SR,output='sos'),x)
    return x*np.exp(-np.arange(n)/SR*55)
CH={'D':[62,66,69],'A':[61,64,69],'Bm':[62,66,71],'G':[62,67,71]}
ROOT={'D':38,'A':45,'Bm':47,'G':43}
PROG=['D','A','Bm','G','D','A','G','A','Bm','G','D','A','G','A','D','D']
MEL=[[(78,1.5),(76,.5),(74,1),(73,1)],[(73,1.5),(74,.5),(76,2)],[(74,1.5),(73,.5),(71,1),(74,1)],[(71,2),(69,1),(71,1)],
     [(74,1),(78,1),(81,1.5),(78,.5)],[(76,2),(73,1),(76,1)],[(74,1),(76,.5),(78,.5),(79,1),(76,1)],[(76,3),(None,1)],
     [(78,1.5),(76,.5),(74,1),(78,1)],[(79,1.5),(78,.5),(76,2)],[(74,1),(76,1),(78,1),(81,1)],[(81,1.5),(79,.5),(78,1),(76,1)],
     [(74,1.5),(76,.5),(78,1),(79,1)],[(78,1),(76,1),(73,2)],[(74,1.5),(73,.5),(74,1),(78,1)],[(74,3),(None,1)]]
ARP=[0,1,2,1,0,2,1,2]   # восьмые по аккорду, октавой выше пэда
padbus=np.zeros((N,2)); 
for b,ch in enumerate(PROG):
    t0=b*BAR
    for k,m in enumerate(CH[ch]):
        s=pad(m-12,BAR); i=int(t0*SR); j=min(N,i+len(s)); s=s[:j-i]
        padbus[i:j,0]+=s*(0.9 if k!=2 else 0.6); padbus[i:j,1]+=s*(0.6 if k!=2 else 0.9)
    r=ROOT[ch]; add(bass(r,BEAT*1.6),t0,0,0.55); add(bass(r+(7 if ch!='Bm' else 7),BEAT*1.6),t0+2*BEAT,0,0.4)
    tones=CH[ch]
    for s8 in range(8):
        m=tones[ARP[s8]]+(12 if s8 in (2,5,7) else 0)
        add(epiano(m,BEAT*0.45,0.85 if s8%2==0 else 0.6),t0+s8*BEAT/2,(-0.35 if s8%2 else 0.25),0.16)
    for s8 in range(8):
        if s8%2: add(shaker(),t0+s8*BEAT/2+0.012*rng.standard_normal(),0.4,0.035*(1.1 if s8 in (3,7) else 0.8))
    t=t0
    for m,d in MEL[b]:
        if m: add(bell(m,d*BEAT,1.0),t,0.05,0.22)
        t+=d*BEAT
mix+=padbus*0.06
# реверберация
ir_n=int(2.2*SR); tt=np.arange(ir_n)/SR
ir=rng.standard_normal((ir_n,2))*np.exp(-tt*3.0)[:,None]
ir=np.stack([sosfilt(butter(2,5500,'lp',fs=SR,output='sos'),ir[:,c]) for c in range(2)],1); ir/=np.sqrt((ir**2).sum(0))
wet=np.stack([fftconvolve(mix[:,c],ir[:,c])[:N] for c in range(2)],1)
out=mix*0.82+wet*0.32
# мягкий срез низа и верха
out=np.stack([sosfilt(butter(2,[45,12000],'bp',fs=SR,output='sos'),out[:,c]) for c in range(2)],1)
# бесшовный цикл: хвост после 16 тактов накладываем на начало
loop=out[:L].copy(); loop[:TAIL]+=out[L:L+TAIL]
loop/=np.max(np.abs(loop))/0.6        # пик −4.4 дБ, тихо для фона
wavfile.write("loop.wav",SR,(loop*32767).astype(np.int16))
print("длительность", round(L/SR,2), "с; RMS", round(20*np.log10(np.sqrt((loop**2).mean())),1),"дБ")
print("стык: разница соседних отсчётов на шве", float(np.abs(loop[-1]-loop[0]).max()), "типичная", float(np.abs(np.diff(loop[:2000],axis=0)).max()))
