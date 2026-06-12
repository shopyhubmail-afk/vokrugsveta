/* panels.jsx — три варианта нижней зоны игрового экрана:
   DeedPanel (A · карточка-титул), RibbonPanel (B · лента+миникарта), FocusPanel (C · фокус-сектор) */

function money(n){ return '$' + n.toLocaleString('ru-RU'); }

/* кнопки действий по фазе хода — общая логика, общий вид кнопок */
function Actions({ phase, cell, rentDue, A }) {
  if (phase === 'idle') {
    return (
      <button className="btn primary" onClick={A.roll}>
        <i className="ti ti-cube"></i> Бросить кубики
      </button>
    );
  }
  if (phase === 'moving') {
    return <button className="btn ghost" style={{ flex: 1 }} onClick={A.skip}>пропустить анимацию</button>;
  }
  if (phase === 'buy') {
    return (
      <div className="acts">
        <button className="btn primary" onClick={A.buy}>Купить за {money(cell.price)}</button>
        <button className="btn sec" onClick={A.auction}>Аукцион</button>
        <button className="btn sec icon" onClick={A.trade} title="обмен"><i className="ti ti-arrows-exchange"></i></button>
        <button className="btn sec icon" onClick={A.chat} title="чат"><i className="ti ti-message"></i></button>
      </div>
    );
  }
  if (phase === 'rent') {
    return (
      <div className="acts">
        <button className="btn primary" style={{ background: 'var(--bad)' }} onClick={A.endTurn}>
          Оплатить аренду {money(rentDue)}
        </button>
        <button className="btn sec icon" onClick={A.trade} title="обмен"><i className="ti ti-arrows-exchange"></i></button>
      </div>
    );
  }
  if (phase === 'own') {
    return (
      <div className="acts">
        <button className="btn sec" style={{ flex: 1, padding: '13px' }} onClick={A.endTurn}><i className="ti ti-check"></i> Дальше</button>
      </div>
    );
  }
  if (phase === 'special') {
    return <button className="btn gold" style={{ flex: 1, padding: '13px' }} onClick={A.endTurn}>Продолжить</button>;
  }
  // bought / done
  return (
    <button className="btn green" style={{ flex: 1, padding: '13px' }} onClick={A.endTurn}>
      <i className="ti ti-check"></i> Передать ход
    </button>
  );
}

function Hint({ phase, hint, A }) {
  return (
    <div className="hint">
      {hint && <span dangerouslySetInnerHTML={{ __html: hint }}></span>}
    </div>
  );
}

/* карточка-«титул» недвижимости */
function Deed({ cell, regions }) {
  if (!cell) return null;
  if (cell.type === 'prop') {
    const rg = regions[cell.region];
    return (
      <div className="deed">
        <div className="hd" style={{ background: rg.color }}>
          <div className="nm">{cell.name}</div>
          <div className="rg">{rg.label}</div>
        </div>
        <div className="tb">
          <div className="r"><span>Аренда</span><b>{money(cell.rent[0])}</b></div>
          <div className="r"><span>С 1 домом</span><b>{money(cell.rent[1])}</b></div>
          <div className="r"><span>С отелем</span><b>{money(cell.rent[5])}</b></div>
          <div className="pr">Цена покупки — {money(cell.price)}</div>
        </div>
      </div>
    );
  }
  // спец-клетки
  const map = {
    air: { c: '#6c5a44', t: 'Аэропорт', s: 'Международный хаб' },
    util:{ c: '#4a6f7a', t: cell.name, s: 'Инфраструктура' },
    tax: { c: '#7a4a44', t: cell.name, s: 'Платёж в казну' },
    chance:{ c: 'var(--cap)', t: 'Мировое событие', s: 'Тяните карту' },
    chest:{ c: 'var(--as)', t: 'Удача', s: 'Тяните карту' },
    corner:{ c: '#5c5142', t: cell.name, s: 'Угол поля' },
  };
  const m = map[cell.type] || map.corner;
  return (
    <div className="deed">
      <div className="hd" style={{ background: m.c }}><div className="nm">{m.t}</div></div>
      <div className="tb" style={{ textAlign: 'center', padding: '12px 14px' }}>
        <i className={'ti ' + (cell.icon || 'ti-map-pin')} style={{ fontSize: 26, color: m.c }}></i>
        <div style={{ marginTop: 4 }}>{m.s}{cell.amount ? ' — ' + money(cell.amount) : ''}{cell.price ? ' — ' + money(cell.price) : ''}</div>
      </div>
    </div>
  );
}

/* ---------- ВАРИАНТ A: карточка-титул ---------- */
function DeedPanel({ cell, regions, phase, rentDue, hint, A }) {
  const showDeed = phase !== 'idle' && phase !== 'moving';
  return (
    <div className="dock">
      {showDeed && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 11 }}>
          <div style={{ width: 210, transform: 'rotate(-1.5deg)' }}><Deed cell={cell} regions={regions} /></div>
        </div>
      )}
      <Hint phase={phase} hint={hint} A={A} />
      {phase === 'idle' || phase === 'moving' || phase === 'special'
        ? <div className="acts"><Actions phase={phase} cell={cell} rentDue={rentDue} A={A} /></div>
        : <Actions phase={phase} cell={cell} rentDue={rentDue} A={A} />}
    </div>
  );
}

/* ---------- ВАРИАНТ B: лента клеток + миникарта ---------- */
function RibbonTile({ cell, regions, current, players, owners }) {
  const rg = cell.region ? regions[cell.region] : null;
  const bandColor = rg ? rg.color : 'var(--muted)';
  const here = players.filter(p => p.pos === cell.i);
  return (
    <div className={'rtile' + (current ? ' cur' : '')}>
      <div className="band" style={{ background: bandColor }}></div>
      <div className="tb">
        {cell.type === 'prop' ? (
          <>
            <div className="tn">{cell.name}</div>
            {current ? (
              <>
                <div className="tp">{rg.label} · {owners[cell.i] ? 'занят' : 'свободен'}</div>
                <div className="meta">
                  <span className="price">{money(cell.price)}</span>
                  <div style={{ display: 'flex' }}>
                    {here.map((p, k) => (
                      <div key={p.id} className={'av' + (p.photo ? ' photo' : '')}
                           style={{ width: 22, height: 22, fontSize: 9, border: '2px solid #fff', marginLeft: k ? -8 : 0, background: p.photo ? undefined : p.color }}>
                        {p.bot ? <i className="ti ti-robot"></i> : (p.photo ? '' : p.initials)}</div>
                    ))}
                  </div>
                </div>
              </>
            ) : <div className="tp">{money(cell.price)}</div>}
          </>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <i className={'ti ' + (cell.icon || 'ti-map-pin')} style={{ fontSize: current ? 22 : 16, color: 'var(--muted)' }}></i>
            <div className="tp">{cell.type === 'air' ? 'аэро' : cell.type === 'util' ? 'сеть' : cell.name.toLowerCase()}</div>
          </div>
        )}
      </div>
    </div>
  );
}
function RibbonPanel({ cell, cells, regions, phase, rentDue, hint, A, players, owners, focusIdx }) {
  const window5 = [-2, -1, 0, 1, 2].map(d => cells[(focusIdx + d + 40) % 40]);
  const me = players[0];
  return (
    <>
      <div className="ribbon">
        <div className="minimap">
          <div className="ring"></div>
          {players.slice(0, 4).map(p => {
            const c = VS.cellCenter(p.pos);
            return <div key={p.id} className="dot" style={{ left: 'calc(' + c.left + '% - 3px)', top: 'calc(' + c.top + '% - 3px)', background: p.color }}></div>;
          })}
        </div>
        <div className="ribbonScroll">
          {window5.map((c, k) => (
            <RibbonTile key={c.i + '-' + k} cell={c} regions={regions} current={c.i === focusIdx}
                        players={players} owners={owners} />
          ))}
        </div>
      </div>
      <div className="dock">
        <Hint phase={phase} hint={hint} A={A} />
        {phase === 'idle' || phase === 'moving' || phase === 'special'
          ? <div className="acts"><Actions phase={phase} cell={cell} rentDue={rentDue} A={A} /></div>
          : <Actions phase={phase} cell={cell} rentDue={rentDue} A={A} />}
      </div>
    </>
  );
}

/* ---------- ВАРИАНТ C: атласный фокус-сектор ---------- */
function FocusPanel({ cell, regions, phase, rentDue, hint, A, dice, rolling }) {
  const rg = cell && cell.type === 'prop' ? regions[cell.region] : null;
  const Die = window.VSBoard.Die;
  return (
    <div className="felt">
      <div className="grab"></div>
      <div className="heroRow">
        {cell && cell.type === 'prop' ? (
          <div className="heroTile">
            <div className="top" style={{ background: rg.color }}>{cell.name}</div>
            <div className="body2">
              <div className="rg">{rg.label}</div>
              <div className="pr">{money(cell.price)}</div>
            </div>
          </div>
        ) : (
          <div className="heroTile">
            <div className="ico" style={{ background: '#2c8268', color: '#fff' }}><i className={'ti ' + ((cell && cell.icon) || 'ti-map-pin')}></i></div>
            <div className="body2"><div className="rg">{cell ? cell.name : ''}</div></div>
          </div>
        )}
        <div className="heroInfo">
          {cell && cell.type === 'prop' ? (
            <>
              <div className="ttl">{cell.name}</div>
              <div className="sub">{rg.label} · {phase === 'buy' ? 'свободен' : phase === 'rent' ? 'занят соперником' : 'на поле'}</div>
              <div className="rentline">
                <span className="rc">аренда <b>{money(cell.rent[0])}</b></span>
                <span className="rc">отель <b>{money(cell.rent[5])}</b></span>
              </div>
            </>
          ) : (
            <>
              <div className="ttl">{cell ? cell.name : 'Ход'}</div>
              <div className="sub">{phase === 'idle' ? 'твой ход — брось кубики' : 'тяни карту события'}</div>
            </>
          )}
        </div>
      </div>

      <div className="dice" style={{ marginTop: 13, marginBottom: 11 }}>
        {dice && <><Die n={dice[0]} rolling={rolling} size={30} /><Die n={dice[1]} rolling={rolling} size={30} /></>}
      </div>

      <Hint phase={phase} hint={hint} A={A} />
      {phase === 'idle' || phase === 'moving' || phase === 'special'
        ? <div className="acts"><Actions phase={phase} cell={cell} rentDue={rentDue} A={A} /></div>
        : <Actions phase={phase} cell={cell} rentDue={rentDue} A={A} />}
    </div>
  );
}

Object.assign(window, { DeedPanel, RibbonPanel, FocusPanel, money });
