all:
	@type node-gyp > /dev/null 2>&1 && make gyp || ( >&2 echo "ERROR! node-gyp is not available."; exit 1 )

gyp:
	node-gyp configure
	node-gyp build

clean:
	@type node-gyp > /dev/null 2>&1 && make clean-gyp || ( >&2 echo "ERROR! node-gyp is not available."; exit 1 )

clean-gyp:
	@node-gyp clean 2>/dev/null

.PHONY: all gyp clean clean-gyp
