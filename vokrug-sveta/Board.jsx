/* Board.jsx — наклонённая доска с толщиной, клетки-регионы, объёмные пешки,
   дома/отели, кубики и зум на сектор по тапу. Чистый презентационный компонент. */
const { useMemo, useState, useEffect, useRef } = React;

const PIPS = {
  1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8],
};
function Die({ n, rolling, size = 28 }) {
  const on = new Set(PIPS[n] || []);
  // «приземление»: когда бросок заканчивается — короткий отскок с пружинкой
  const [settled, setSettled] = useState(false);
  const prevRolling = useRef(rolling);
  useEffect(() => {
    let t;
    if (prevRolling.current && !rolling) {
      setSettled(true);
      t = setTimeout(() => setSettled(false), 450);
    }
    prevRolling.current = rolling;
    return () => clearTimeout(t);
  }, [rolling]);
  return (
    <div className={'die obj' + (rolling ? ' rolling' : '') + (settled ? ' settle' : '')} style={{ width: size, height: size }}>
      {Array.from({ length: 9 }).map((_, k) => (
        <span key={k} className={on.has(k) ? 'pip' : ''}></span>
      ))}
    </div>
  );
}

function Pawn({ player, left, top, hopping, offset, active }) {
  return (
    <div className={'pawn' + (hopping ? ' hop' : '') + (active ? ' active' : '')}
         style={{ left: left + '%', top: top + '%', zIndex: 8 + (offset || 0) }}>
      <div className="pawnInner" style={{ marginLeft: (offset || 0) * 9 - ((offset || 0) ? 0 : 0) + 'px' }}>
        <div className="head">
          <div className={'av' + (player.photo ? ' photo' : '')}
               style={{ background: player.photo ? undefined : player.color }}>
            {player.bot ? <i className="ti ti-robot" style={{ fontSize: 10 }}></i> : (player.photo ? '' : player.initials)}
          </div>
        </div>
        <div className="neck"></div>
        <div className="foot"></div>
      </div>
    </div>
  );
}

// Maps special cell types/kinds to short CAPS labels
const CELL_LABEL = {
  air: 'АЭРО',
  chance: 'СОБЫТИЕ',
  chest: 'УДАЧА',
  tax: 'СБОР',
};
const CORNER_LABEL = {
  go: 'СТАРТ',
  jail: 'ТРАНЗИТ',
  free: 'КУРОРТ',
  gotojail: 'КАРАНТИН',
};
// Map icon keywords to util labels
function utilLabel(icon) {
  if (!icon) return 'УТИЛЬ';
  if (icon.includes('bolt') || icon.includes('lightning')) return 'ЭНЕРГО';
  if (icon.includes('droplet')) return 'ВОДА';
  return 'УТИЛЬ';
}

function Cell({ cell, regions, owner, houses, isActive }) {
  const p = VS.gridPos(cell.i);
  const region = cell.region ? regions[cell.region] : null;
  const side = p.side; // 'b','t','l','r'
  const isCorner = cell.type === 'corner';
  const cls = ['cell', isCorner ? 'corner' : side, isActive ? 'active' : ''].join(' ');

  // Determine text rotation for left/right sides
  const isProp = cell.type === 'prop';
  const isSpecial = !isProp && !isCorner;

  // Размер шрифта по длине названия — одна строка без переносов, никогда не налезает
  const nm = cell.name || '';
  const fitFont = nm.length >= 9 ? '4.2px' : nm.length >= 8 ? '4.6px' : nm.length >= 6 ? '5.2px' : '6px';

  // Name text style varies by side
  let nameStyle = {
    position: 'absolute',
    fontSize: fitFont,
    fontWeight: 700,
    fontFamily: "'Manrope', sans-serif",
    color: '#2c2722',
    lineHeight: 1.1,
    textAlign: 'center',
    pointerEvents: 'none',
    zIndex: 2,
    maxWidth: '100%',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  };
  let priceStyle = {
    position: 'absolute',
    fontSize: '5px',
    fontWeight: 700,
    fontFamily: "'Manrope', sans-serif",
    color: '#4a3c2a',
    pointerEvents: 'none',
    zIndex: 2,
    textAlign: 'center',
  };
  let iconStyle = {
    fontSize: isCorner ? '13px' : '10px',
    color: isCorner ? '#2c2722' : '#5a4e3c',
    zIndex: 2,
    position: 'relative',
  };
  let labelStyle = {
    position: 'absolute',
    fontSize: '4.5px',
    fontWeight: 800,
    fontFamily: "'Manrope', sans-serif",
    color: '#2c2722',
    letterSpacing: '0.06em',
    textAlign: 'center',
    pointerEvents: 'none',
    zIndex: 2,
    textTransform: 'uppercase',
  };

  if (side === 'b') {
    // band at top (inner): имя+цена одним столбцом под полосой — наложение исключено
    nameStyle = { ...nameStyle, left: '1px', right: '1px', top: '36%', bottom: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' };
    priceStyle = { ...priceStyle, bottom: '1px', left: 0, right: 0 };
    labelStyle = { ...labelStyle, bottom: '1px', left: 0, right: 0 };
  } else if (side === 't') {
    // band at bottom (inner): имя+цена одним столбцом над полосой
    nameStyle = { ...nameStyle, left: '1px', right: '1px', top: '2px', bottom: '36%', display: 'flex', alignItems: 'center', justifyContent: 'center' };
    priceStyle = { ...priceStyle, top: '1px', left: 0, right: 0 };
    labelStyle = { ...labelStyle, top: '1px', left: 0, right: 0 };
  } else if (side === 'l') {
    // band at right, name rotated 90deg, price near left edge
    nameStyle = { ...nameStyle, top: '1px', bottom: '1px', left: '4%', right: '36%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      writingMode: 'vertical-rl', transform: 'rotate(180deg)' };
    priceStyle = { ...priceStyle, left: '1px', top: 0, bottom: 0, writingMode: 'vertical-rl', transform: 'rotate(180deg)' };
    labelStyle = { ...labelStyle, left: '1px', top: 0, bottom: 0, writingMode: 'vertical-rl', transform: 'rotate(180deg)' };
  } else if (side === 'r') {
    // band at left, name rotated -90deg, price near right edge
    nameStyle = { ...nameStyle, top: '1px', bottom: '1px', left: '36%', right: '4%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      writingMode: 'vertical-rl' };
    priceStyle = { ...priceStyle, right: '1px', top: 0, bottom: 0, writingMode: 'vertical-rl' };
    labelStyle = { ...labelStyle, right: '1px', top: 0, bottom: 0, writingMode: 'vertical-rl' };
  }

  // Determine special label
  let cellLabel = null;
  if (isCorner) {
    cellLabel = CORNER_LABEL[cell.kind] || cell.name;
  } else if (cell.type === 'util') {
    cellLabel = utilLabel(cell.icon);
  } else if (CELL_LABEL[cell.type]) {
    cellLabel = CELL_LABEL[cell.type];
  }

  return (
    <div className={cls} style={{ gridRow: p.r, gridColumn: p.c }}>
      {region && <div className="band" style={{ background: region.color }}></div>}

      {/* Icon for all non-prop cells */}
      {cell.icon && !isProp && (
        <i className={'ci ti ' + cell.icon} style={iconStyle}></i>
      )}

      {/* Special cell short label — only on top/bottom, sides are too narrow.
          Для air/util цена включается в ярлык, чтобы не рисовать два текста в одной точке */}
      {isSpecial && cellLabel && (side === 'b' || side === 't') && (
        <span style={labelStyle}>
          {cellLabel}{(cell.type === 'air' || cell.type === 'util') && cell.price ? ` · ${cell.price}` : ''}
        </span>
      )}

      {/* Corner label */}
      {isCorner && cellLabel && (
        <span style={{
          position: 'absolute', fontSize: '5px', fontWeight: 800,
          fontFamily: "'Manrope', sans-serif", color: '#2c2722',
          letterSpacing: '0.04em', textTransform: 'uppercase',
          bottom: '3px', left: 0, right: 0, textAlign: 'center', zIndex: 2,
        }}>{cellLabel}</span>
      )}

      {/* Prop cell: имя+цена всегда одним столбцом — наложение исключено по построению */}
      {isProp && cell.name && (
        <div style={{ ...nameStyle, flexDirection: 'column', gap: '1px' }}>
          <span>{cell.name}</span>
          <span style={{ fontSize: '4.5px', color: '#4a3c2a', fontWeight: 700, whiteSpace: 'nowrap' }}>{cell.price}</span>
        </div>
      )}

      {/* Price tag: air/util — только на боковых сторонах (на b/t цена уже в ярлыке) */}
      {(cell.type === 'air' || cell.type === 'util') && (side === 'l' || side === 'r') && (
        <span style={{ ...priceStyle, ...(side === 'l' ? { left: '1px', writingMode: 'vertical-rl', transform: 'rotate(180deg)', top: 0, bottom: 0 } : { right: '1px', writingMode: 'vertical-rl', top: 0, bottom: 0 }) }}>{cell.price}</span>
      )}

      {owner && <div className="owner" style={{ background: owner }}></div>}
      {houses > 0 && (
        <div className="stack obj" style={{ transform: 'translateX(-50%) rotateX(-15deg)' }}>
          {houses >= 5
            ? <div className="hotel"></div>
            : Array.from({ length: houses }).map((_, k) => <div key={k} className="house"></div>)}
        </div>
      )}
    </div>
  );
}

function Board({
  cells, regions, owners, houses, players, activeCell,
  zoom, boardSize = 270, dice, rolling, hoppingId, showCenterDice = true,
  onBoardTap, logoSmall, activePlayerId,
}) {
  // группируем пешки по клетке для аккуратной стопки
  const byCell = useMemo(() => {
    const m = {};
    players.forEach(pl => { (m[pl.pos] = m[pl.pos] || []).push(pl); });
    return m;
  }, [players]);

  let wrapTransform = '';
  if (zoom != null && zoom) {
    const c = VS.cellCenter(activeCell);
    const s = 1.6;
    const dx = (50 - c.left);
    const dy = (58 - c.top);
    wrapTransform = `scale(${s}) translate(${dx}%, ${dy}%)`;
  }

  return (
    <div className="boardwrap" style={{ transform: wrapTransform }}>
      <div className="board" style={{ width: boardSize, height: boardSize }} onClick={onBoardTap}>
        {cells.map(cell => (
          <Cell key={cell.i} cell={cell} regions={regions}
                owner={owners[cell.i]} houses={houses[cell.i] || 0}
                isActive={cell.i === activeCell} />
        ))}

        <div className="center">
          <div className="logo" style={{ fontSize: logoSmall ? 15 : 19 }}>
            ВОКРУГ<br /><span>СВЕТА</span>
          </div>
          <div className="decks">
            <div style={{
              background: '#1a3a5c',
              transform: 'rotate(-4deg)',
              border: '1.5px solid rgba(255,255,255,0.3)',
              boxShadow: '2px 3px 8px rgba(0,0,0,0.4)',
              color: '#fff',
              letterSpacing: '0.08em',
              fontSize: logoSmall ? 7.5 : 9,
              fontWeight: 700,
              fontFamily: "'Manrope', sans-serif",
              padding: logoSmall ? '4px 8px' : '5px 11px',
              borderRadius: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              userSelect: 'none',
            }}>
              <i className="ti ti-world"></i> СОБЫТИЯ
            </div>
            <div style={{
              background: '#2a4a1a',
              transform: 'rotate(3deg)',
              border: '1.5px solid rgba(255,255,255,0.3)',
              boxShadow: '2px 3px 8px rgba(0,0,0,0.4)',
              color: '#fff',
              letterSpacing: '0.08em',
              fontSize: logoSmall ? 7.5 : 9,
              fontWeight: 700,
              fontFamily: "'Manrope', sans-serif",
              padding: logoSmall ? '4px 8px' : '5px 11px',
              borderRadius: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              userSelect: 'none',
            }}>
              <i className="ti ti-gift"></i> УДАЧА
            </div>
          </div>
          {showCenterDice && dice && (
            <div className="dice">
              <Die n={dice[0]} rolling={rolling} size={logoSmall ? 22 : 26} />
              <Die n={dice[1]} rolling={rolling} size={logoSmall ? 22 : 26} />
            </div>
          )}
        </div>

        {/* слой пешек */}
        <div className="tokens">
          {Object.entries(byCell).map(([cellIdx, list]) => {
            const c = VS.cellCenter(Number(cellIdx));
            return list.map((pl, k) => (
              <Pawn key={pl.id} player={pl} left={c.left} top={c.top}
                    offset={k} hopping={pl.id === hoppingId}
                    active={activePlayerId != null && pl.id === activePlayerId} />
            ));
          })}
        </div>
      </div>
    </div>
  );
}

window.VSBoard = { Board, Die, Pawn, Cell };
