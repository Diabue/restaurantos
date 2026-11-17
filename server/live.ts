import { Injectable } from '@nestjs/common';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { db, guestAccess, staffAccess } from './store';

type Room = { restaurant?: string; visit?: string; public?: string };

@Injectable()
export class Live {
  private readonly clients = new Map<WebSocket, Room>();

  attach(server: Server) {
    const wss = new WebSocketServer({ server, path: '/live', maxPayload: 2048 });
    wss.on('connection', socket => {
      const timeout = setTimeout(() => socket.close(1008), 5000);
      socket.on('error', () => socket.terminate());
      socket.on('close', () => { clearTimeout(timeout); this.clients.delete(socket); });
      socket.once('message', async raw => {
        try {
          const { kind, secret, code } = JSON.parse(raw.toString());
          let room: Room | undefined;
          if (kind === 'guest' && typeof secret === 'string') {
            const visit = await guestAccess(db, secret);
            if (visit) room = { visit: visit.id, public: visit.table.restaurantId };
          } else if (kind === 'staff' && typeof secret === 'string') {
            const employee = await staffAccess(db, secret);
            if (employee) room = { restaurant: employee.restaurantId };
          } else if (kind === 'menu' && typeof code === 'string') {
            const table = await db.diningTable.findUnique({ where: { code } });
            if (table) room = { public: table.restaurantId };
          }
          if (!room || socket.readyState !== WebSocket.OPEN) { socket.close(1008); return; }
          clearTimeout(timeout);
          this.clients.set(socket, room);
          socket.send('refresh');
        } catch { socket.close(1008); }
      });
    });
    const interval = setInterval(() => {
      for (const socket of wss.clients) {
        if (!alive.delete(socket)) { socket.terminate(); continue; }
        socket.ping();
      }
    }, 25000);
    interval.unref();
    const alive = new WeakSet<WebSocket>();
    wss.on('connection', socket => { alive.add(socket); socket.on('pong', () => alive.add(socket)); });
    wss.on('close', () => clearInterval(interval));
  }

  publish(restaurant: string, visit?: string, menu = false) {
    for (const [socket, room] of this.clients) {
      if (room.restaurant === restaurant || (visit && room.visit === visit) || (menu && room.public === restaurant)) {
        if (socket.readyState === WebSocket.OPEN) socket.send('refresh');
      }
    }
  }
}
