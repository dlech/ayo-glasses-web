import "./App.css";
import {
  Box,
  Button,
  Card,
  Flex,
  IconButton,
  Popover,
  SimpleGrid,
  Spinner,
  useBreakpointValue,
} from "@chakra-ui/react";
import { ColorModeButton } from "./components/ui/color-mode";
import { useAppDispatch, useAppSelector } from "./hooks";
import { useMemo } from "react";
import { VscInfo } from "react-icons/vsc";
import { connectBle, disconnectBle } from "./ble";

function App() {
  const dispatch = useAppDispatch();
  const ble = useAppSelector((state) => state.ble);
  const popoverPlacement = useBreakpointValue<
    { placement: "right" } | undefined
  >({ base: undefined, md: { placement: "right" } });

  const onClick = useMemo(() => {
    switch (ble.status) {
      case "disconnected":
        return () => dispatch(connectBle());
      case "connected":
        return () => dispatch(disconnectBle());
      default:
        return () => {};
    }
  }, [dispatch, ble.status]);

  const buttonContent = useMemo(() => {
    switch (ble.status) {
      case "disconnected":
        return <>Connect</>;
      case "connected":
        return <>Disconnect</>;
      default:
        return <Spinner size="sm" />;
    }
  }, [ble.status]);

  return (
    <>
      <Flex
        alignItems="center"
        justifyContent="center"
        height="100vh"
        position="relative"
      >
        <Box position="absolute" top="10px" right="10px">
          <ColorModeButton />
        </Box>
        <Card.Root width={"300px"}>
          <Card.Header>Ayo Glasses</Card.Header>
          <Card.Body>
            <Flex alignItems="center" justifyContent="space-between">
              Battery: {isNaN(ble.battery) ? "?" : `${ble.battery}%`}
              <Popover.Root positioning={popoverPlacement}>
                <Popover.Trigger asChild>
                  <IconButton
                    disabled={ble.status !== "connected"}
                    size="xs"
                    variant="outline"
                  >
                    <VscInfo />
                  </IconButton>
                </Popover.Trigger>
                <Popover.Positioner>
                  <Popover.Content>
                    <Popover.CloseTrigger />
                    <Popover.Arrow>
                      <Popover.ArrowTip />
                    </Popover.Arrow>
                    <Popover.Body display="flex" flexDir="column" gap="10px">
                      <Popover.Title>Info</Popover.Title>
                      <SimpleGrid columns={2}>
                        <Box>Serial Number:</Box>
                        <Box>{ble.serialNumber || "?"}</Box>
                        <Box>Firmware Version:</Box>
                        <Box>{ble.firmwareVersion || "?"}</Box>
                        <Box>Hardware Version:</Box>
                        <Box>{ble.hardwareVersion || "?"}</Box>
                      </SimpleGrid>
                    </Popover.Body>
                  </Popover.Content>
                </Popover.Positioner>
              </Popover.Root>
            </Flex>
          </Card.Body>
          <Card.Footer
            display="flex"
            flexDirection="column"
            alignItems="stretch"
          >
            <Button
              disabled={
                ble.status !== "disconnected" && ble.status !== "connected"
              }
              onClick={onClick}
            >
              {buttonContent}
            </Button>
          </Card.Footer>
        </Card.Root>
      </Flex>
    </>
  );
}

export default App;
