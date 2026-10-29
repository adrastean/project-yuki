import argparse
import asyncio

import edge_tts


async def synthesize(args):
    communicate = edge_tts.Communicate(
        args.text,
        args.voice,
        rate=args.rate,
        volume=args.volume,
        pitch=args.pitch,
    )
    await communicate.save(args.output)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--voice", default="en-US-JennyNeural")
    parser.add_argument("--rate", default="+5%")
    parser.add_argument("--volume", default="+0%")
    parser.add_argument("--pitch", default="+0Hz")
    args = parser.parse_args()
    asyncio.run(synthesize(args))


if __name__ == "__main__":
    main()
