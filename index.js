const _ = require('lodash');
const hue = require('node-hue-api');
const HueApi = hue.HueApi;
const { client, xml } = require('@xmpp/client');
const { config } = require('./config');

const api = new HueApi(config.hue.host, config.hue.username);

const fldState = hue.lightState.create().transitionFast().rgb(0, 255, 122).brightness(100).on();
const svrState = hue.lightState.create().transitionFast().rgb(255, 255, 0).brightness(100).on();
const torState = hue.lightState.create().transitionFast().rgb(255, 0, 0).brightness(100).on();
const stateOff = hue.lightState.create().transitionFast().off();

const delay = 750;

const triggerWarning = (light, color) => {
  api.lightStatus(light, (err, res) => {
    let regState;
    if (res.state.on) {
      regState = hue.lightState.create()
        .transitionFast()
        .on(true)
        .bri(res.state.bri)
        .hue(res.state.hue)
        .sat(res.state.sat);
    } else {
      regState = hue.lightState.create().transitionFast().on(false);
    }
    api.setLightState(light, color).then().done();
    setTimeout(() => {
      api.setLightState(light, stateOff).then().done();
    }, delay * 1);
    setTimeout(() => {
      api.setLightState(light, color).then().done();
    }, delay * 2);
    setTimeout(() => {
      api.setLightState(light, stateOff).then().done();
    }, delay * 3);
    setTimeout(() => {
      api.setLightState(light, color).then().done();
    }, delay * 4);
    setTimeout(() => {
      api.setLightState(light, regState).then().done();
    }, delay * 10);
  });
};

const xmpp = client({
  service: 'xmpps://nwws-oi.weather.gov:5223',
  username: config.xmpp.username,
  password: config.xmpp.password
});

const inside = (point, vs) => {
  const x = point[0], y = point[1];

  let _inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];

    const intersect = ((yi > y) != (yj > y))
      && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) _inside = !_inside;
  }

  return _inside;
};

xmpp.on('error', err => {
  console.error('❌', err.toString())
})

xmpp.on('offline', () => {
  console.log('⏹', 'offline')
})

xmpp.on('stanza', async stanza => {
  if (stanza.is('iq')) {
    stanza.children.map(async child => {
      if (child.name == 'ping') {
        const pong = (
          xml('iq', {
            to: stanza.attrs.from,
            id: stanza.attrs.id,
            from: stanza.attrs.to,
            type: 'result'
          })
        );
        console.log('Sending response to ping...');
        await xmpp.send(pong);
        console.log('Pong!');
      }
    });
  }
  if (stanza.is('message')) {
    const stanzaAttr = stanza.children.find(x => { return x.name == 'x' });
    if (_.get(stanzaAttr, 'attrs.awipsid')) {
      switch (stanzaAttr.attrs.awipsid.substr(0, 3)) {
        case 'FFW':
        case 'SVR':
        case 'TOR':
          const pol = stanza.children.find(x => { return x.name == 'x' });
          const coords = pol.children[0].match(/(?<=LAT\.{3}LON\s).+?(?=[^\d\s])/sg)[0]
            .replace(/\r?\n|\r/g, ' ')
            .split(' ')
            .filter(val => val)
            .map((val, idx) => {
              return idx % 2 === 0 ? val / 100 : -1 * (val / 100);
            })
            .reduce((result, value, index, array) => {
              if (index % 2 === 0) {
                result.push(array.slice(index, index + 2));
              }
              return result;
            }, []);
          coords.push([coords[0][0], coords[0][1]]);
          const warning = inside([config.coordinates.lat, config.coordinates.lng], coords);
          if (warning) {
            if (stanzaAttr.attrs.awipsid.substr(0, 3) == 'FFW') {
              config.hue.flood.map(id => {
                triggerWarning(id, fldState);
              });
            } else if (stanzaAttr.attrs.awipsid.substr(0, 3) == 'SVR') {
              config.hue.severe.map(id => {
                triggerWarning(id, svrState);
              });
            } else if (stanzaAttr.attrs.awipsid.substr(0, 3) == 'TOR') {
              config.hue.tornado.map(id => {
                triggerWarning(id, torState);
              });
            }
          }
          break;
        default:
          break;
      }
    }
  }
});

xmpp.on('online', async address => {
  console.log('▶', 'online as', address.toString());

  const message = (
    xml('presence', {
      to: `nwws@conference.nwws-oi.weather.gov/${config.xmpp.username}`
    })
  );

  await xmpp.send(message);
});

xmpp.start().catch(console.error);