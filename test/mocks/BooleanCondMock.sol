contract BooleanCondMock {
    function isFinalized(bytes query, uint timeout) view external returns (bool) {
        return true;
    }

    function isSatisfied(bytes query) view external returns (bool) {
        return true;
    }
}
