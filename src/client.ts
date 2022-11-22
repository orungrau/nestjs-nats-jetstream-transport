import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy, ReadPacket, WritePacket } from '@nestjs/microservices';
import { Codec, connect, JSONCodec, NatsConnection } from 'nats';
import { Observable } from 'rxjs';
import { NATS_JETSTREAM_OPTIONS } from './constants';
import { NatsJetStreamClientOptions } from './interfaces/nats-jetstream-client-options.interface';
import { isString } from '@nestjs/common/utils/shared.utils';

@Injectable()
export class NatsJetStreamClientProxy extends ClientProxy {
  private nc: NatsConnection;
  private codec: Codec<JSON>;

  constructor(
    @Inject(NATS_JETSTREAM_OPTIONS) private options: NatsJetStreamClientOptions,
  ) {
    super();
    this.codec = JSONCodec();
  }

  async connect(): Promise<NatsConnection> {
    if (!this.nc) {
      this.nc = await connect(this.options.connectionOptions);
      if (this.options.connectionOptions.connectedHook) {
        this.options.connectionOptions.connectedHook(this.nc);
      }
    }

    return this.nc;
  }

  async close() {
    await this.nc.drain();
    await this.nc.close();
    this.nc = undefined;
  }

  send<TResult = any, TInput = any>(
    pattern: any,
    data: TInput,
  ): Observable<TResult> {
    // FIXME:
    if (isString(pattern)) {
      pattern = { cmd: pattern };
    }
    return super.send(pattern, data);
  }

  protected publish(
    packet: ReadPacket,
    callback: (packet: WritePacket) => void,
  ): () => void {
    const payload = this.codec.encode(packet.data);
    const subject = this.normalizePattern(packet.pattern);

    this.nc
      .request(subject, payload, {
        timeout: this.options.requestTimeout | 30000,
      })
      .then((msg) => this.codec.decode(msg.data) as WritePacket)
      .then((packet) => callback(packet))
      .catch((err) => {
        callback({ err });
      });
    return () => null;
  }

  protected async dispatchEvent(packet: ReadPacket): Promise<any> {
    const payload = this.codec.encode(packet.data);
    const subject = this.normalizePattern(packet.pattern);
    const jetStreamOpts = this.options.jetStreamOption;
    const jetStreamPublishOpts = this.options.jetStreamPublishOptions;
    const js = this.nc.jetstream(jetStreamOpts);
    return js.publish(subject, payload, jetStreamPublishOpts);
  }
}
