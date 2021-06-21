# node-red-contrib-pccc

A Node-RED node to interact with some Allen-Bradley PLCs using PCCC protocol.
Based on the awesome work of [plcpeople/nodepccc](https://github.com/plcpeople/nodepccc).


## Installing

You can install this node directly from the "Manage Palette" menu in the Node-RED interface. There are no external dependencies or compilation steps.

Alternatively, run the following command in your Node-RED user directory - typically `~/.node-red` on Linux or `%HOMEPATH%\.nodered` on Windows

        npm install node-red-contrib-pccc


## Usage

Just drop a `pccc in` node to read and watch addresses of the PLC, or a `pccc out` node to write values to the PLC. Both of them need a `pccc endpoint`, where you can configure the address of the PLC (IP Address, port, and routing), the cycle time and timeout values, and the list of addresses available on the PLC.


### Addressing

The addresses follow the same syntax of what would be used on RSLogix, so for example `B3:0/0` addresses the bit 0 of byte 0 in the file B3, and `F8:1` points to the float 1 at the file F8.


### About routing

The configuration of routing follows a very special syntax for now

    0x01,0x00,0x01,0x00
      |    |    |    |
      |    |    |    +-- 0: The slot of the PLC
      |    |    +------- 1: Route over the backplane
      |    +------------ Reserved, always zero
      +----------------- 1: Number of words (1 = 2 bytes) of the routing section

You most likely just want to change the last number to the slot of the PLC when connecting to ControlLogix/CompactLogix controllers


## Wishlist
- Validate addresses
- Improve routing configuration


## Bugs and enhancements

Please share your ideas and experiences on the [Node-RED forum](https://discourse.nodered.org/), or open an issue on the [page of the project on GitHub](https://github.com/st-one-io/node-red-contrib-pccc)


## License
Copyright: (c) 2016-2021, [ST-One Ltda.](https://st-one.io)

GNU General Public License v3.0+ (see [LICENSE](LICENSE) or https://www.gnu.org/licenses/gpl-3.0.txt)
