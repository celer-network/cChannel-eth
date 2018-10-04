pb:
	@echo Generate .sol from chain.proto. assume $(HOME)/Celer/pb3sol/ exists
	protoc -Iproto --plugin=protoc-gen-sol=$(HOME)/Celer/pb3sol/src/protoc/plugin/gen_sol.py --sol_out=. proto/chain.proto
	mv chain.pb.sol cChannelObject.sol
