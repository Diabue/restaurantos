import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import { DemoTables } from './demo-tables';
import { Guest } from './guest';
import { StaffApp } from './staff';
import './style.css';

const path = location.pathname.split('/').filter(Boolean);
createRoot(document.getElementById('root')!).render(path[0] === 'staff' ? <StaffApp /> :
  path[0] === 't' && path[1] ? <Guest code={path[1]} /> : <DemoTables />);
