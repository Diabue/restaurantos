import { db, demo, passwordHash } from './store';

try {
  if (demo()) {
    const restaurant = await db.restaurant.upsert({ where: { slug: 'oliwa' }, update: {}, create: {
      slug: 'oliwa', name: 'Oliwa i Ogień', tagline: 'Kuchnia sezonowa · przy wspólnym stole', image: '/images/hero.jpg',
    } });
    if (!(await db.category.count({ where: { restaurantId: restaurant.id } }))) {
      const catalog = [
        ['Przystawki', [
          ['Sałatka z ogrodu', 'Młode liście, sezonowe warzywa, zioła i cytrynowy winegret.', 'burrata', 2900],
          ['Grzanka z awokado', 'Chleb na zakwasie, kremowe awokado, chili i prażony sezam.', 'toast', 2700],
        ]],
        ['Dania główne', [
          ['Stek z grilla', 'Wołowina, masło ziołowe, warzywa z rusztu i sos pieprzowy.', 'steak', 7900],
          ['Makaron z zielonym pesto', 'Makaron, bazylia, parmezan i orzechy piniowe.', 'pasta', 4400],
        ]],
        ['Napoje', [['Lemoniada domowa', 'Cytryna, mięta i odrobina syropu z kwiatów bzu.', 'drink', 1400]]],
        ['Desery', [['Sernik z owocami', 'Kremowy sernik z sosem z owoców leśnych.', 'dessert', 2600]]],
      ] as const;
      await db.$transaction(catalog.map(([name, products], position) => db.category.create({ data: {
        name, position, restaurantId: restaurant.id, products: { create: products.map(([name, description, image, price], index) => ({
          name, description, image: `/images/${image}.jpg`, price, fiscalCode: `DEMO${position + 1}${index + 1}`, vatCode: 'A',
          options: image === 'drink' ? [{ id: 'small', name: '300 ml', extra: 0 }, { id: 'large', name: '500 ml', extra: 500 }] : [],
          createdOrder: new Date(Date.now() + index),
        })) },
      } })));
    }
    if (!(await db.diningTable.count({ where: { restaurantId: restaurant.id } }))) {
      const positions = [[17, 22], [39, 22], [62, 22], [84, 22], [17, 64], [39, 64], [62, 64], [84, 64]];
      await db.diningTable.createMany({ data: positions.map(([x, y], index) => ({
        restaurantId: restaurant.id, number: index + 1, x, y, seats: index % 3 === 0 ? 2 : 4, code: index === 7 ? 'demo' : undefined,
      })) });
    }
    for (const [username, name, roles, canFiscalize] of [
      ['manager', 'Alicja', ['WAITER', 'KITCHEN', 'MANAGER'], true], ['kelner', 'Michał', ['WAITER'], true], ['kuchnia', 'Kuchnia', ['KITCHEN'], false],
    ] as const) {
      await db.employee.upsert({ where: { restaurantId_username: { restaurantId: restaurant.id, username } }, update: {}, create: {
        restaurantId: restaurant.id, username, name, roles: [...roles], canFiscalize, password: passwordHash('demo1234'),
      } });
    }
    console.log('Demo Oliwa i Ogień gotowe. Gość może ustawić własny PIN przy wolnym stoliku.');
  } else {
    const { BOOTSTRAP_SLUG: slug, BOOTSTRAP_NAME: name, BOOTSTRAP_USER: username, BOOTSTRAP_PASSWORD: password } = process.env;
    if (!slug || !/^[a-z0-9-]{2,50}$/.test(slug) || !name || !username || !/^[a-z0-9._-]{2,50}$/.test(username) || !password || password.length < 12) {
      throw new Error('Ustaw BOOTSTRAP_SLUG, BOOTSTRAP_NAME, BOOTSTRAP_USER oraz BOOTSTRAP_PASSWORD (minimum 12 znaków).');
    }
    await db.restaurant.create({ data: { slug, name, employees: { create: { username, name: username, password: passwordHash(password), roles: ['MANAGER'] } } } });
    console.log('Utworzono lokal i konto managera.');
  }
} finally {
  await db.$disconnect();
}
