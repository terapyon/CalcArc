# Random key lines mixing π, recip, ×÷+−, x², √, x^0.5, then trig (RAD/DEG). Truth = SymPy exact, N(…, 50).
#
# 1.2.5 の設計書（docs/superpowers/specs/2026-10-14-pi-power-marks-design.md）§0 の乱択。
#   cd reference && uv --no-config run python ../docs/superpowers/sdd/2026-10-14-pi-power-marks/ppm-rand.py OUT.json 20261014 20000
# 引数は 出力・種・試行の数。試行のうち √ に負の値が来たもの・0 で割るもの・複素になるもの・
# |値| > 1e300 は捨てるので、20000 回で 19,331 行になる。
# 真値: キー列と同じ順に SymPy の厳密な式を組み（sp.pi・sp.Rational・sp.sqrt。simplify は呼ばない）、
# 極（zoo・oo・nan）は 'Math ERROR'、それ以外は N(v, 50) を float にして real_ref.format_rect で 10 桁にする。
import random, sys, json
import sympy as sp
from calcarc_reference import real_ref
rng = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 20261014)
POOL = ['1', '2', '3', '0.5', '6', '4', '12', '30', '45', '90', '180', '1.5', '0.25', '7', '1E15N', '1E16N']
def keys_of(tok):
    if tok == 'pi': return ['pi'], sp.pi
    if tok.endswith('N'):
        m, e = tok[:-1].split('E'); return [m, 'exp'] + list(e) + ['neg'], sp.Rational(int(m), 10**int(e))
    return [c if c != '.' else 'dot' for c in tok], sp.Rational(tok)
ERR = 'Math ERROR'
rows = []
N = int(sys.argv[3]) if len(sys.argv) > 3 else 6000
fam_names = ['km1', 'k2', 'mix', 'root', 'any']
for _ in range(N):
    fam = rng.choice(fam_names)
    rad = rng.random() < 0.7
    keys = ['angle_toggle'] if rad else []
    if fam == 'root':
        start = rng.choice(['pi', 'pi', '2', '3', '0.5'])
    else:
        start = rng.choice(['pi', 'pi', '1', '2', '0.5', '30', '3'])
    k, v = keys_of(start); keys += k
    steps = rng.randint(1, 4)
    ok = True
    for _s in range(steps):
        r = rng.random()
        if fam == 'km1' and r < 0.5:
            op = rng.choice(['recip', 'divpi', 'mulpi'])
        elif fam == 'k2' and r < 0.5:
            op = rng.choice(['sqr', 'mulpi', 'divpi'])
        elif fam == 'mix' and r < 0.5:
            op = rng.choice(['addpi', 'subpi', 'add', 'sub'])
        elif fam == 'root' and r < 0.5:
            op = rng.choice(['sqrt', 'half', 'sqr'])
        else:
            op = rng.choice(['add', 'sub', 'mul', 'div', 'recip', 'sqr', 'sqrt', 'neg', 'half', 'addpi', 'subpi', 'mulpi', 'divpi'])
        if op in ('add', 'sub', 'mul', 'div'):
            t = rng.choice(POOL + ['pi'])
            k, w = keys_of(t); keys += [op] + k + ['eq']
            v = {'add': v + w, 'sub': v - w, 'mul': v * w, 'div': (v / w) if w != 0 else sp.zoo}[op]
        elif op in ('addpi', 'subpi', 'mulpi', 'divpi'):
            o = op[:3]; keys += [o, 'pi', 'eq']
            v = {'add': v + sp.pi, 'sub': v - sp.pi, 'mul': v * sp.pi, 'div': v / sp.pi}[o]
        elif op == 'recip':
            keys += ['recip']; v = (1 / v) if v != 0 else sp.zoo
        elif op == 'sqr':
            keys += ['sqr']; v = v**2
        elif op == 'neg':
            keys += ['neg']; v = -v
        elif op in ('sqrt', 'half'):
            if sp.N(v, 30) < 0: ok = False; break
            keys += ['sqrt'] if op == 'sqrt' else ['pow', '0', 'dot', '5', 'eq']
            v = sp.sqrt(v)
        if v.has(sp.zoo, sp.nan): ok = False; break
    if not ok: continue
    end = rng.random()
    if end < 0.75:
        fn = rng.choice(['sin', 'cos', 'tan'])
        keys += [fn]
        x = v if rad else v * sp.pi / 180
        v = {'sin': sp.sin, 'cos': sp.cos, 'tan': sp.tan}[fn](x)
        if rng.random() < 0.4:
            c = rng.choice(['0.5', '1'])
            k, w = keys_of(c); keys += ['sub'] + k + ['eq']; v = v - w
    pass
    if v.has(sp.zoo, sp.nan, sp.oo):
        want = ERR
    else:
        n = sp.N(v, 50)
        if not n.is_real: continue
        f = float(n)
        if abs(f) > 1e300: continue
        want = real_ref.format_rect(f, 0.0)
    rows.append((fam + ('_rad' if rad else '_deg'), ' '.join(keys), want))
json.dump(rows, open(sys.argv[1], 'w'))
print(len(rows))
