import React, { useEffect, useState, useRef } from 'react';
import * as d3 from 'd3';
import { feature } from 'topojson-client';
import api from '../utils/api';

const COUNTRY_POS = {
  US:[37,-95],  GB:[55,-3],   DE:[51,10],  FR:[46,2],   RU:[60,100],
  CN:[35,105],  JP:[36,138],  IN:[20,77],  BR:[-10,-55],CA:[60,-95],
  AU:[-27,133], NL:[52,5],    PL:[52,20],  UA:[49,31],  IT:[42,12],
  ES:[40,-4],   KR:[37,128],  SG:[1,104],  HK:[22,114], TW:[24,121],
  ZA:[-29,25],  MX:[23,-102], AR:[-34,-64],SE:[62,15],  NO:[60,10],
  FI:[60,25],   DK:[56,10],   CH:[47,8],   AT:[47,14],  BE:[50,4],
  CZ:[50,15],   RO:[46,25],   HU:[47,19],  TR:[39,35],  IL:[31,35],
  SA:[24,45],   AE:[24,54],   PK:[30,70],  BD:[24,90],  TH:[15,100],
  VN:[16,108],  ID:[-5,120],  PH:[13,122], MY:[3,110],  NG:[10,8],
  EG:[27,30],   KE:[-1,37],   GH:[8,-1],   MA:[32,-6],
};

export default function GeoMap() {
  const svgRef  = useRef(null);
  const [data,  setData]    = useState([]);
  const [topo,  setTopo]    = useState(null);
  const [tooltip,setTooltip]= useState(null);

  useEffect(() => {
    api.get('/events/geo/summary').then(r => setData(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then(r => r.json()).then(setTopo).catch(() => {});
  }, []);

  useEffect(() => {
    if (!svgRef.current || !topo) return;
    const el     = svgRef.current;
    const width  = el.clientWidth || 700;
    const height = Math.round(width * 0.5);

    const svg  = d3.select(el).attr('viewBox', `0 0 ${width} ${height}`)
                               .attr('preserveAspectRatio', 'xMidYMid meet');
    svg.selectAll('*').remove();

    const proj = d3.geoNaturalEarth1()
      .scale(width / 7)
      .translate([width / 2, height / 2])
      .precision(0.1);
    const path = d3.geoPath().projection(proj);

    // Draw base map
    const countries = feature(topo, topo.objects.countries);
    svg.append('g')
      .selectAll('path')
      .data(countries.features)
      .join('path')
      .attr('d', path)
      .attr('fill', '#1f2937')
      .attr('stroke', '#374151')
      .attr('stroke-width', 0.4);

    if (!data.length) return;

    const maxTotal = d3.max(data, d => +d.total) || 1;
    const rScale   = d3.scaleSqrt().domain([0, maxTotal]).range([4, 30]);

    const g = svg.append('g');
    data.forEach(d => {
      const pos = COUNTRY_POS[d.country_code];
      if (!pos) return;
      const xy = proj([pos[1], pos[0]]);
      if (!xy || isNaN(xy[0])) return;

      const blockedRatio = +d.total > 0 ? +d.blocked / +d.total : 0;
      const color = blockedRatio > 0.5 ? '#ef4444'
                  : blockedRatio > 0.2 ? '#f59e0b'
                  : '#6366f1';

      g.append('circle')
        .attr('cx', xy[0]).attr('cy', xy[1])
        .attr('r',  rScale(+d.total))
        .attr('fill', color)
        .attr('fill-opacity', 0.65)
        .attr('stroke', color)
        .attr('stroke-width', 1)
        .attr('cursor', 'pointer')
        .on('mouseover', (event) => setTooltip({
          x: event.offsetX, y: event.offsetY,
          name: d.country_name || d.country_code,
          total: d.total, blocked: d.blocked, allowed: d.allowed,
        }))
        .on('mouseout', () => setTooltip(null));
    });
  }, [topo, data]);

  return (
    <div className="relative">
      <svg ref={svgRef} className="w-full rounded-lg bg-gray-900" style={{ height: 'auto', display: 'block' }} />
      {tooltip && (
        <div className="absolute z-10 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}>
          <p className="font-semibold text-white mb-1">{tooltip.name}</p>
          <p className="text-gray-300">Total:   {tooltip.total}</p>
          <p className="text-red-400">Blocked: {tooltip.blocked}</p>
          <p className="text-green-400">Allowed: {tooltip.allowed}</p>
        </div>
      )}
      {data.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
          No geo data yet — requires MaxMind license key in .env
        </div>
      )}
      <div className="flex gap-4 mt-2 text-xs text-gray-500 justify-end">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block"/>Normal</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-yellow-500 inline-block"/>&gt;20% blocked</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"/>&gt;50% blocked</span>
      </div>
    </div>
  );
}