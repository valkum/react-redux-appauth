import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { AuthAdapter, EventType, ExtendedOidcTokenResponse } from './AuthAdapter';
import { AuthAdapterProps, AuthContextProps, AuthProviderProps, AuthProviderSignInProps, AuthProviderSignOutProps } from './AuthInterface';
import { expired, loaded, loading, logged_out, selectIsAuthed, selectIsLoading, token_updated } from './AuthSlice';


/**
 * @private
 * @hidden
 * @param location
 */
 export const hasCodeInUrl = (location: Location): boolean => {
  const searchParams = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(location.hash.replace('#', '?'));

  return Boolean(
    searchParams.get('code') ||
      searchParams.get('id_token') ||
      searchParams.get('session_state') ||
      hashParams.get('code') ||
      hashParams.get('id_token') ||
      hashParams.get('session_state'),
  );
};


const initAdapter = (props: AuthAdapterProps): AuthAdapter => {
  if (props.authAdapter) return props.authAdapter;
  return new AuthAdapter(
    props
  )
}

export const AuthContext = React.createContext<AuthContextProps | undefined>(undefined);
export const AuthProvider: FC<AuthProviderProps> = ({
  store,
  children,
...props
}) => {
  return (<Provider store={store}><AuthProviderContext store={store} {...props}>{children}</AuthProviderContext></Provider>)
}

// Todo add an onError callback
const AuthProviderContext: FC<AuthProviderProps> = ({
  store,
  children,
  autoSignIn = false,
  onBeforeSignIn,
  onSignIn,
  onSignOut,
  ...props
}) => {
  const dispatch = useDispatch();
  const isLoading = useSelector(selectIsLoading);
  const isAuthed = useSelector(selectIsAuthed);
  // const [userData, setUserData] = useState<User | null>(null);

  const [adapter] = useState<AuthAdapter>(initAdapter(props));

  const signOutHooks = async (): Promise<void> => {
    // setUserData(null);
    dispatch(logged_out())
    onSignOut && onSignOut();
  };

  const signInPopupHooks = async (): Promise<void> => {
    dispatch(loading())
    await adapter.signInPopup({});
    onSignIn && onSignIn();
  };

  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const init = useCallback(async (): Promise<void> => {
    /**
     * Check if the user is returning back from OIDC. Todo retry a couple of times before dispatching an error state
     */
    if (hasCodeInUrl(location)) {
      await adapter.fetchServiceConfiguration().then(() => {
        adapter.completeAuthorizationRequestIfPossible();
      });
      return;
    }

    if ((!isAuthed) && autoSignIn) {
      onBeforeSignIn && onBeforeSignIn();

    } else if (isMountedRef.current) {
      dispatch(loaded())
      onSignIn && onSignIn()
    }
    return;
  }, [location, adapter, dispatch, isAuthed, autoSignIn, onBeforeSignIn, onSignIn]);

  useEffect(() => {
    init();
  }, [init]);

  const registerHandler = useCallback(async () => {
    // for refreshing react state when new state is available in e.g. session storage
    const updateState = async (type: EventType, token_response: ExtendedOidcTokenResponse | undefined) => {
      switch (type) {
        case EventType.RENEWED:
          isMountedRef.current && token_response!.toReduxState().then((value) => dispatch(token_updated(value)));
          break;
        case EventType.EXPIRED:
          isMountedRef.current && dispatch(expired());
      }
    };
    await adapter.fetchServiceConfiguration();
    adapter.addHandler(updateState);

    return () => adapter.removeHandler(updateState);
  }, [adapter, dispatch]);

  useEffect(() => {
    registerHandler()
  }, [registerHandler]);

  return (<Provider store={store}>
    <AuthContext.Provider value={{
      signIn: async (args: AuthProviderSignInProps = {}): Promise<void> => {
        await adapter.signInRedirect(args);
      },
      signInPopup: async (): Promise<void> => {
        await signInPopupHooks();
      },
      signOut: async (args: AuthProviderSignOutProps = {}): Promise<void> => {
        if (args.signoutRedirect) {
          await adapter.signOutRedirect(args);
        } else {
          await adapter.signOut();
        }
        await signOutHooks();
      },
      signOutRedirect: async (args: AuthProviderSignOutProps = {}): Promise<void> => {
        await adapter.signOutRedirect(args);
        await signOutHooks();
      },
      isLoading,
    }}
    >
      {children}
    </AuthContext.Provider>
    </Provider> 
  )
}
